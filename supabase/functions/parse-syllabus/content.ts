// Downloads an upload's files and turns them into Claude content blocks:
// PDF -> document, photos -> image (in page order), DOCX -> mammoth HTML -> text document,
// text / pasted text / Canvas HTML -> text document. Binaries go base64-inline when the request
// stays small, otherwise through the Files API (the caller deletes those files afterwards).
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Buffer } from 'node:buffer';
import { type ClaudeContentBlock, uploadFileForClaude } from '../_shared/claude.ts';
import {
  classifyFile,
  compactText,
  type FileClassification,
  htmlToText,
  type ImageMediaType,
  INLINE_PAYLOAD_LIMIT_BYTES,
  looksLikeHtml,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  shouldUseFilesApi,
} from '../_shared/documents.ts';
import { HttpError } from '../_shared/http.ts';
import type { PromptDocument } from '../_shared/prompts.ts';
import { docxToText } from './docx.ts';
import { SYLLABI_BUCKET, type UploadFile, type UploadRow } from './rows.ts';

type Supported = Exclude<FileClassification, { kind: 'unsupported' }>;

type Part =
  | { kind: 'pdf'; name: string; bytes: Uint8Array }
  | { kind: 'image'; name: string; bytes: Uint8Array; mediaType: ImageMediaType }
  | { kind: 'text'; name: string; text: string; doc: PromptDocument['kind'] };

export interface PreparedContent {
  blocks: ClaudeContentBlock[];
  documents: PromptDocument[];
  usedFilesApi: boolean;
}

const TOO_LONG = 'This document is too long to read in one pass — try uploading the schedule pages separately.';
const utf8 = new TextEncoder();

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');

/** Throws the student-facing unsupported_file error for the first file Claude can't read. */
export function classifyOrThrow(file: UploadFile): Supported {
  const classification = classifyFile(file.mime, file.name);
  if (classification.kind === 'unsupported') throw new HttpError('unsupported_file', classification.message);
  return classification;
}

async function download(client: SupabaseClient, file: UploadFile): Promise<Uint8Array> {
  const { data, error } = await client.storage.from(SYLLABI_BUCKET).download(file.path, {}, { cache: 'no-store' });
  if (error || !data) {
    console.error(`parse-syllabus: download failed (${error?.name ?? 'no data'})`);
    throw new HttpError('not_found', `We couldn't find “${file.name}” in your uploads. Please add it again.`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

async function toPart(file: UploadFile, kind: Supported, bytes: Uint8Array): Promise<Part> {
  switch (kind.kind) {
    case 'pdf':
      return { kind: 'pdf', name: file.name, bytes };
    case 'image':
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new HttpError('too_large', `“${file.name}” is larger than 5 MB. Retake the photo or upload a PDF instead.`);
      }
      return { kind: 'image', name: file.name, bytes, mediaType: kind.mediaType };
    case 'docx':
      return { kind: 'text', name: file.name, text: await docxToText(bytes, file.name), doc: 'docx' };
    case 'text':
      return { kind: 'text', name: file.name, text: compactText(new TextDecoder().decode(bytes)), doc: 'text' };
  }
}

function pastedPart(upload: UploadRow): Part | null {
  const raw = upload.pasted_text?.trim();
  if (!raw) return null;
  if (upload.source === 'canvas') {
    return { kind: 'text', name: 'Canvas syllabus page', text: looksLikeHtml(raw) ? htmlToText(raw) : compactText(raw), doc: 'canvas' };
  }
  const name = upload.kind === 'toc' ? 'Pasted table of contents' : 'Pasted syllabus text';
  return { kind: 'text', name, text: compactText(raw), doc: 'pasted' };
}

export async function prepareContent(opts: {
  userClient: SupabaseClient;
  anthropic: Anthropic;
  upload: UploadRow;
  /** Receives each Files API id as soon as it exists, so the caller can clean up after failures. */
  uploadedFileIds: string[];
}): Promise<PreparedContent> {
  const { upload } = opts;
  const kinds = upload.files.map(classifyOrThrow);
  const images = kinds.filter((k) => k.kind === 'image').length;
  if (images > MAX_IMAGES) throw new HttpError('too_large', `That's ${images} photos — upload at most ${MAX_IMAGES} at a time.`);

  const byteArrays = await Promise.all(upload.files.map((file) => download(opts.userClient, file)));
  const parts = await Promise.all(upload.files.map((file, i) => toPart(file, kinds[i], byteArrays[i])));
  const pasted = pastedPart(upload);
  if (pasted) parts.push(pasted);

  const usable = parts.filter((p) => p.kind !== 'text' || p.text.length > 0);
  if (usable.length === 0) throw new HttpError('bad_request', "We couldn't find any text in this upload. Try a PDF or a clearer photo.");

  const textBytes = usable.reduce((sum, p) => sum + (p.kind === 'text' ? utf8.encode(p.text).byteLength : 0), 0);
  if (textBytes > INLINE_PAYLOAD_LIMIT_BYTES) throw new HttpError('too_large', TOO_LONG);
  const binarySizes = usable.flatMap((p) => (p.kind === 'text' ? [] : [p.bytes.byteLength]));
  const useFilesApi = shouldUseFilesApi(binarySizes, textBytes);

  const fileId = async (p: Extract<Part, { bytes: Uint8Array }>, mime: string) => {
    const id = await uploadFileForClaude(opts.anthropic, p.bytes, p.name, mime);
    opts.uploadedFileIds.push(id);
    return id;
  };

  const blocks: ClaudeContentBlock[] = [];
  const documents: PromptDocument[] = [];
  let imageNumber = 0;
  const pageWord = upload.kind === 'toc' ? 'Page' : 'Photo';
  for (const part of usable) {
    switch (part.kind) {
      case 'pdf': {
        const source = useFilesApi
          ? { type: 'file' as const, file_id: await fileId(part, 'application/pdf') }
          : { type: 'base64' as const, media_type: 'application/pdf' as const, data: toBase64(part.bytes) };
        blocks.push({ type: 'document', source, title: part.name });
        documents.push({ name: part.name, kind: 'pdf' });
        break;
      }
      case 'image': {
        imageNumber++;
        blocks.push({ type: 'text', text: `${pageWord} ${imageNumber} of ${images}: ${part.name}` });
        const source = useFilesApi
          ? { type: 'file' as const, file_id: await fileId(part, part.mediaType) }
          : { type: 'base64' as const, media_type: part.mediaType, data: toBase64(part.bytes) };
        blocks.push({ type: 'image', source });
        documents.push({ name: part.name, kind: 'image' });
        break;
      }
      case 'text':
        blocks.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: part.text }, title: part.name });
        documents.push({ name: part.name, kind: part.doc });
        break;
    }
  }
  return { blocks, documents, usedFilesApi: useFilesApi };
}

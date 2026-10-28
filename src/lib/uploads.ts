// Capture helpers for syllabus / table-of-contents uploads: pick files, photos or camera pages,
// normalise every image to a JPEG whose long side is at most 2000 px (this also turns HEIC into
// JPEG), validate sizes, and upload to the private `syllabi` bucket at
// `<uid>/<upload_id>/<n>.<ext>`. Screens orchestrate these through src/data/capture.ts.
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { UploadFile } from '@/types/db';

import { AppError } from './functions';
import { supabase } from './supabase';

export const SYLLABI_BUCKET = 'syllabi';
/** Storage bucket limit (supabase migration: 31457280 bytes). */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
/** Claude rejects images of 5 MB or more. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Long side of every uploaded photo. */
export const MAX_IMAGE_SIDE = 2000;
/** Claude's per-request image count. */
export const MAX_IMAGES = 100;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const JPEG_QUALITIES = [0.82, 0.68, 0.55] as const;

export type CaptureFileKind = 'pdf' | 'docx' | 'text' | 'image';
export type CaptureOrigin = 'files' | 'photos' | 'camera';

/** One page or document waiting to be uploaded, already validated and converted. */
export interface CapturedFile {
  key: string;
  uri: string;
  name: string;
  mime: string;
  size: number;
  kind: CaptureFileKind;
  origin: CaptureOrigin;
}

export interface PickOutcome {
  files: CapturedFile[];
  /** One plain sentence per file that could not be added. */
  problems: string[];
}

const EXTENSION: Record<CaptureFileKind, string> = { pdf: 'pdf', docx: 'docx', text: 'txt', image: 'jpg' };

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

/** "12.4 MB", "820 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type Classified = { kind: CaptureFileKind; mime: string } | { kind: 'unsupported'; message: string };

/** What a picked document is, from its MIME type with the extension as a fallback. */
export function classifyDocument(name: string, mime: string | null | undefined): Classified {
  const type = (mime ?? '').split(';')[0].trim().toLowerCase();
  const ext = extensionOf(name);
  const label = name.trim() || 'This file';
  if (type === 'application/pdf' || ext === 'pdf') return { kind: 'pdf', mime: 'application/pdf' };
  if (type === DOCX_MIME || ext === 'docx') return { kind: 'docx', mime: DOCX_MIME };
  if (type === 'text/plain' || type === 'text/markdown' || ext === 'txt' || ext === 'md') {
    return { kind: 'text', mime: 'text/plain' };
  }
  if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'tif', 'tiff'].includes(ext)) {
    return { kind: 'image', mime: 'image/jpeg' };
  }
  if (type === 'application/msword' || ext === 'doc') {
    return { kind: 'unsupported', message: `“${label}” is an older Word file (.doc). Save it as .docx or PDF, then add it again.` };
  }
  if (ext === 'pages' || ext === 'key' || ext === 'numbers') {
    return { kind: 'unsupported', message: `“${label}” is an Apple iWork file. Export it as PDF first.` };
  }
  return { kind: 'unsupported', message: `“${label}” isn't a PDF, Word (.docx), text file or photo.` };
}

function fileSize(uri: string): number {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

function deleteQuietly(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache files are cleaned up by the OS eventually.
  }
}

function jpegName(name: string | null | undefined, fallback: string): string {
  const base = (name ?? '').trim().replace(/\.[a-z0-9]+$/i, '');
  return `${base || fallback}.jpg`;
}

/**
 * Re-encodes any image (HEIC, PNG, huge camera JPEG) as a JPEG whose long side is at most
 * 2000 px and that stays under Claude's 5 MB image limit.
 */
export async function prepareImage(uri: string, name: string, origin: CaptureOrigin): Promise<CapturedFile> {
  const context = ImageManipulator.manipulate(uri);
  try {
    let image = await context.renderAsync();
    const longSide = Math.max(image.width, image.height);
    if (longSide > MAX_IMAGE_SIDE) {
      image.release();
      context.resize(image.width >= image.height ? { width: MAX_IMAGE_SIDE, height: null } : { width: null, height: MAX_IMAGE_SIDE });
      image = await context.renderAsync();
    }
    try {
      for (const compress of JPEG_QUALITIES) {
        const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress });
        const size = fileSize(saved.uri);
        if (size > 0 && size < MAX_IMAGE_BYTES) {
          return { key: randomUUID(), uri: saved.uri, name, mime: 'image/jpeg', size, kind: 'image', origin };
        }
        deleteQuietly(saved.uri);
      }
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }
  throw new AppError('too_large', `“${name}” is still over 5 MB after shrinking. Try a closer, simpler photo of the page.`);
}

async function fromDocument(asset: DocumentPicker.DocumentPickerAsset): Promise<CapturedFile | string> {
  const classified = classifyDocument(asset.name, asset.mimeType);
  if (classified.kind === 'unsupported') return classified.message;
  if (classified.kind === 'image') {
    try {
      return await prepareImage(asset.uri, jpegName(asset.name, 'Image'), 'files');
    } catch (error) {
      return error instanceof AppError ? error.message : `We couldn't open “${asset.name}”. Try saving it as a JPEG or PDF.`;
    }
  }
  const size = asset.size ?? fileSize(asset.uri);
  if (size <= 0) return `“${asset.name}” looks empty. Check the file and try again.`;
  if (size > MAX_FILE_BYTES) {
    return `“${asset.name}” is ${formatBytes(size)}. Files can be up to 30 MB — try a smaller export or photos of the key pages.`;
  }
  return { key: randomUUID(), uri: asset.uri, name: asset.name, mime: classified.mime, size, kind: classified.kind, origin: 'files' };
}

/** PDF, Word (.docx), text files and images from Files / iCloud Drive. Null when cancelled. */
export async function pickDocuments(): Promise<PickOutcome | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', DOCX_MIME, 'text/plain', 'text/markdown', 'image/*', 'application/msword'],
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const outcome: PickOutcome = { files: [], problems: [] };
  for (const asset of result.assets) {
    const picked = await fromDocument(asset);
    if (typeof picked === 'string') outcome.problems.push(picked);
    else outcome.files.push(picked);
  }
  return outcome;
}

async function fromImageAssets(assets: readonly ImagePicker.ImagePickerAsset[], origin: CaptureOrigin, startIndex: number): Promise<PickOutcome> {
  const outcome: PickOutcome = { files: [], problems: [] };
  let index = startIndex;
  for (const asset of assets) {
    index += 1;
    const fallback = origin === 'camera' ? `Page ${index}` : `Photo ${index}`;
    const name = origin === 'camera' ? `${fallback}.jpg` : jpegName(asset.fileName, fallback);
    try {
      outcome.files.push(await prepareImage(asset.uri, name, origin));
    } catch (error) {
      outcome.problems.push(error instanceof AppError ? error.message : `We couldn't open ${fallback.toLowerCase()}. Try picking it again.`);
    }
  }
  return outcome;
}

/** Photos from the library, multi-select in the order tapped. Null when cancelled. */
export async function pickPhotos(alreadyPicked: number): Promise<PickOutcome | null> {
  const remaining = Math.max(1, MAX_IMAGES - alreadyPicked);
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    orderedSelection: true,
    selectionLimit: remaining,
    quality: 1,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) return null;
  return fromImageAssets(result.assets, 'photos', alreadyPicked);
}

export type CameraOutcome = { status: 'captured'; outcome: PickOutcome } | { status: 'canceled' } | { status: 'denied' };

/** One camera page. Ask again for the next page. */
export async function takePhoto(pageNumber: number): Promise<CameraOutcome> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { status: 'denied' };
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
  if (result.canceled) return { status: 'canceled' };
  return { status: 'captured', outcome: await fromImageAssets(result.assets, 'camera', pageNumber - 1) };
}

/** Removes local cache copies made for an upload (converted photos). */
export function discardLocalCopies(files: readonly CapturedFile[]): void {
  for (const file of files) if (file.kind === 'image') deleteQuietly(file.uri);
}

function storageError(error: { message?: string; statusCode?: string | number } | null): AppError {
  const status = Number(error?.statusCode ?? 0);
  if (status === 413 || /maximum allowed size|too large/i.test(error?.message ?? '')) {
    return new AppError('too_large', 'One of the files is over the 30 MB limit. Remove it or use photos of the key pages.');
  }
  if (status === 415 || /mime type/i.test(error?.message ?? '')) {
    return new AppError('unsupported_file', "One of the files isn't a type we can read. Use PDF, Word (.docx), text or photos.");
  }
  if (status === 401 || status === 403) return new AppError('unauthorized', 'Your session has expired. Please sign in again.');
  return new AppError('network', "Couldn't upload your files. Check your connection and try again.");
}

/** Storage paths of an upload's files: `<uid>/<upload_id>/<n>.<ext>`. */
export function storagePath(userId: string, uploadId: string, index: number, kind: CaptureFileKind): string {
  return `${userId}/${uploadId}/${index}.${EXTENSION[kind]}`;
}

/**
 * Uploads every file in order. On failure the files already stored for this upload are removed
 * again, so a failed capture leaves nothing behind.
 */
export async function uploadCapturedFiles(input: {
  userId: string;
  uploadId: string;
  files: readonly CapturedFile[];
  onProgress?: (done: number, total: number) => void;
}): Promise<UploadFile[]> {
  const { userId, uploadId, files, onProgress } = input;
  const stored: UploadFile[] = [];
  try {
    for (const [index, file] of files.entries()) {
      onProgress?.(index, files.length);
      const path = storagePath(userId, uploadId, index, file.kind);
      let body: ArrayBuffer;
      try {
        body = await new File(file.uri).arrayBuffer();
      } catch (cause) {
        throw new AppError('unsupported_file', `We couldn't read “${file.name}” on this device. Pick it again.`, { cause });
      }
      const { error } = await supabase.storage.from(SYLLABI_BUCKET).upload(path, body, { contentType: file.mime, upsert: true });
      if (error) throw storageError(error as { message?: string; statusCode?: string | number });
      stored.push({ path, mime: file.mime, name: file.name, size: body.byteLength });
    }
    onProgress?.(files.length, files.length);
    return stored;
  } catch (error) {
    await removeStoredFiles(stored.map((file) => file.path));
    throw error;
  }
}

/** Deletes stored upload files (best effort; storage cleanup must never block the student). */
export async function removeStoredFiles(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(SYLLABI_BUCKET).remove([...paths]);
  } catch {
    // Orphaned objects are removed with the account; nothing to tell the student.
  }
}

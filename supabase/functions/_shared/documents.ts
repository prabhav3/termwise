// Pure document helpers for parse-syllabus: file classification, inline-vs-Files-API sizing,
// and HTML/text cleanup. No Deno or Node APIs, so vitest can cover it directly.

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export type FileClassification =
  | { kind: 'pdf'; mediaType: 'application/pdf' }
  | { kind: 'image'; mediaType: ImageMediaType }
  | { kind: 'docx' }
  | { kind: 'text' }
  | { kind: 'unsupported'; message: string };

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Send files base64-inline only while the whole request stays well under the API's 32 MB
 * request cap; base64 strings also sit in the 256 MB edge-function heap twice (encoded and
 * serialized), so the margin is deliberately wide. Above this, binaries go through the Files API.
 */
export const INLINE_PAYLOAD_LIMIT_BYTES = 16 * 1024 * 1024;
/** Claude's per-image size limit. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Claude's per-request image count limit. */
export const MAX_IMAGES = 100;

const IMAGE_TYPES: Record<string, ImageMediaType> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  docx: DOCX_MIME,
  txt: 'text/plain',
  text: 'text/plain',
  md: 'text/plain',
  heic: 'image/heic',
  heif: 'image/heif',
  doc: 'application/msword',
};

const extensionOf = (name: string): string => {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
};

/** Decide how a stored file is sent to Claude, from its MIME type (falling back to the file extension). */
export function classifyFile(mime: string, name: string): FileClassification {
  let type = mime.split(';')[0].trim().toLowerCase();
  if (!type || type === 'application/octet-stream' || type === 'binary/octet-stream') {
    type = EXTENSION_TYPES[extensionOf(name)] ?? type;
  }
  if (type === 'application/pdf') return { kind: 'pdf', mediaType: 'application/pdf' };
  const image = IMAGE_TYPES[type];
  if (image) return { kind: 'image', mediaType: image };
  if (type === DOCX_MIME) return { kind: 'docx' };
  if (type === 'text/plain' || type === 'text/markdown') return { kind: 'text' };

  const label = name.trim() || 'This file';
  if (type === 'image/heic' || type === 'image/heif' || ['heic', 'heif'].includes(extensionOf(name))) {
    return {
      kind: 'unsupported',
      message: `“${label}” is a HEIC photo, which we can't read. Retake it with the in-app camera or pick it again from your library so it's saved as a JPEG.`,
    };
  }
  if (type === 'application/msword' || extensionOf(name) === 'doc') {
    return {
      kind: 'unsupported',
      message: `“${label}” is an older Word file (.doc). Save it as .docx or PDF and upload it again.`,
    };
  }
  return {
    kind: 'unsupported',
    message: `We can't read “${label}”. Upload a PDF, Word (.docx), photo (JPEG, PNG, WebP), or text file instead.`,
  };
}

/** Length of the base64 encoding of `byteLength` bytes. */
export const base64Length = (byteLength: number): number => 4 * Math.ceil(byteLength / 3);

/** True when the binaries (PDFs, images) should be uploaded via the Files API instead of inlined. */
export function shouldUseFilesApi(binaryByteLengths: readonly number[], textByteLength: number): boolean {
  const encoded = binaryByteLengths.reduce((sum, n) => sum + base64Length(n), 0);
  return encoded + textByteLength > INLINE_PAYLOAD_LIMIT_BYTES;
}

/** Characters the Files API rejects in a file name (400 "Invalid file name"). */
// deno-lint-ignore no-control-regex
const FILES_API_FORBIDDEN = /[<>:"|?*\\/\u0000-\u001f]/g;
/** UTF-8 bytes kept from the name's stem: well inside the API's 1–255 characters however they are counted. */
const FILES_API_STEM_BYTES = 200;
const MEDIA_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const utf8Length = (codePoint: number): number => (codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4);

/**
 * The student's file name made acceptable to the Files API upload (1–255 characters, none of
 * < > : " | ? * \ / or U+0000–U+001F): forbidden characters become "_", the stem is shortened,
 * and the extension is kept (or taken from the media type). Only for the upload itself; document
 * titles and the prompt keep the original name.
 */
export function filesApiFileName(name: string, mediaType: string): string {
  const cleaned = name.replace(FILES_API_FORBIDDEN, '_').trim();
  const match = /\.([a-z0-9]{1,10})$/i.exec(cleaned);
  const extension = match ? match[1].toLowerCase() : (MEDIA_EXTENSIONS[mediaType] ?? 'bin');
  let stem = '';
  let bytes = 0;
  for (const char of match ? cleaned.slice(0, match.index) : cleaned) {
    bytes += utf8Length(char.codePointAt(0) ?? 0);
    if (bytes > FILES_API_STEM_BYTES) break;
    stem += char;
  }
  stem = stem.trim();
  // A stem of only dots, dashes, underscores (replaced characters) or spaces says nothing.
  return `${/[^\s._-]/u.test(stem) ? stem : 'document'}.${extension}`;
}

/** Normalize plain text: unify newlines, drop control/zero-width characters, trim lines, squeeze blank runs. */
export function compactText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‍﻿]/g, '')
    .replace(/[\t  -   　]+/g, ' ')
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const looksLikeHtml = (text: string): boolean => /<\/?[a-z][a-z0-9]*(\s[^>]*)?>/i.test(text);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  middot: '·',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  times: '×',
  divide: '÷',
  plusmn: '±',
  le: '≤',
  ge: '≥',
  rarr: '→',
  larr: '←',
  sect: '§',
  para: '¶',
  shy: '',
  zwj: '',
  zwnj: '',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

const BLOCK_TAGS =
  'address|article|aside|blockquote|body|caption|center|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|header|html|main|nav|ol|p|pre|section|summary|table|ul';

/** Inner HTML of one table cell or heading -> a single line (entities are decoded later, once). */
const inlineText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, ' / ')
    .replace(/<\/?(p|div|li|ul|ol)\b[^>]*>/gi, ' ')
    .replace(/<\/?(span|strong|b|em|i|u|a|font|sup|sub|small|code|mark|abbr)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:\s*\/\s*)+|(?:\s*\/\s*)+$/g, '')
    .trim();

/**
 * HTML (a Canvas syllabus page, or mammoth's DOCX output) -> readable plain text.
 * Keeps document structure the model needs: headings become "## Heading", list items "- item",
 * and every table row becomes one line of " | "-separated cells so schedule tables stay legible.
 */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/\s+/g, ' ');

  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi, (_row, inner: string) => {
    const cells: string[] = [];
    const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|$)/gi;
    for (let m = cellRe.exec(inner); m; m = cellRe.exec(inner)) {
      cells.push(inlineText(m[1].replace(/<\/t[dh]\s*>/gi, '')));
    }
    return cells.some((c) => decodeEntities(c).trim()) ? `\n${cells.join(' | ')}` : '';
  });
  s = s.replace(/<caption\b[^>]*>([\s\S]*?)<\/caption\s*>/gi, (_c, inner: string) => `\n${inlineText(inner)}\n`);
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_h, level: string, inner: string) => {
    const text = inlineText(inner);
    return text ? `\n\n${'#'.repeat(Number(level))} ${text}\n\n` : '\n';
  });
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n---\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li\s*>/gi, '')
    .replace(new RegExp(`</?(?:${BLOCK_TAGS}|t[dhr])\\b[^>]*>`, 'gi'), '\n')
    .replace(/<[^>]+>/g, '');

  return compactText(
    decodeEntities(s)
      .split('\n')
      .filter((line) => line.trim() !== '-')
      .join('\n'),
  );
}

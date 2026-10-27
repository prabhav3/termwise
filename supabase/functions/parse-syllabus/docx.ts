// DOCX -> text via mammoth's HTML output, which keeps schedule tables as <table> rows that
// htmlToText turns into " | "-separated lines.
import mammoth from 'mammoth';
import mammothPromises from 'mammoth/lib/promises.js';
import { Buffer } from 'node:buffer';
import { htmlToText } from '../_shared/documents.ts';
import { HttpError } from '../_shared/http.ts';

// mammoth wraps every result in a bluebird-compatible Promise subclass wired up with `__proto__`
// assignment. Deno removes Object.prototype.__proto__, so that subclass never inherits from
// Promise and convertToHtml throws "ExternalPromise.resolve is not a function". mammoth's entry
// module calls the wrapper through this shared module object, so swapping in identity makes it
// return plain native promises (only the legacy `.done()` helper is lost).
(mammothPromises as unknown as { toExternalPromise: <T>(promise: Promise<T>) => Promise<T> }).toExternalPromise = (promise) =>
  promise;

export async function docxToText(bytes: Uint8Array, name: string): Promise<string> {
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) },
      // Images would otherwise be inlined as data URIs; the parser only needs text and tables.
      { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })), externalFileAccess: false },
    );
    html = result.value;
  } catch {
    throw new HttpError('unsupported_file', `We couldn't open “${name}”. Save it as a PDF and upload that instead.`);
  }
  return htmlToText(html);
}

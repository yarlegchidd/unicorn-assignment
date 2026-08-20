import { CONFIG } from './config';
import { failures } from './failures';

export type MediaKind = 'image' | 'video';

export interface DriveFile {
  fileId: string;
  fileName: string | null;
  mimeType: string;
  kind: MediaKind;
  /** null when Drive omits Content-Length. */
  byteSize: number | null;
  body: ReadableStream<Uint8Array>;
}

const ID_PATTERNS: RegExp[] = [
  /\/file\/d\/([\w-]{10,})/,
  /\/d\/([\w-]{10,})/,
  /[?&]id=([\w-]{10,})/,
  /\/open\?.*\bid=([\w-]{10,})/,
];

const DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
]);

export function extractFileId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw failures.notADriveLink();

  if (/^[\w-]{20,}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw failures.notADriveLink();
  }

  if (!DRIVE_HOSTS.has(url.hostname)) throw failures.notADriveLink();

  for (const pattern of ID_PATTERNS) {
    const match = pattern.exec(url.pathname + url.search);
    if (match?.[1]) return match[1];
  }

  throw failures.notADriveLink();
}

/** confirm=t skips most virus-scan interstitials; otherwise replay hidden form fields. */
function downloadUrl(fileId: string, extra: Record<string, string> = {}): string {
  const url = new URL('https://drive.usercontent.google.com/download');
  url.searchParams.set('id', fileId);
  url.searchParams.set('export', 'download');
  url.searchParams.set('confirm', 't');
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url.toString();
}

const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
} as const;

export async function openDriveFile(input: string): Promise<DriveFile> {
  const fileId = extractFileId(input);

  let response = await requestDrive(downloadUrl(fileId));

  if (looksLikeHtml(response)) {
    const html = await response.text();
    const replay = parseInterstitial(html);
    if (!replay) throw failures.driveForbidden();
    response = await requestDrive(downloadUrl(fileId, replay));
    if (looksLikeHtml(response)) throw failures.driveForbidden();
  }

  if (!response.ok) {
    throw failures.driveUnreachable(`HTTP ${response.status}`);
  }
  if (!response.body) {
    throw failures.driveUnreachable('empty response body');
  }

  const declaredSize = Number(response.headers.get('content-length'));
  const byteSize = Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : null;

  if (byteSize !== null && byteSize > CONFIG.maxBytes) {
    await response.body.cancel();
    throw failures.tooLarge(byteSize, CONFIG.maxBytes);
  }

  const fileName = fileNameFromDisposition(response.headers.get('content-disposition'));
  const { prefix, stream } = await peek(response.body, 32);
  const mimeType = resolveMimeType(response.headers.get('content-type'), prefix, fileName);
  const kind = classify(mimeType);
  if (!kind) {
    await stream.cancel();
    throw failures.unsupportedMedia(mimeType);
  }

  return { fileId, fileName, mimeType, kind, byteSize, body: stream };
}

async function requestDrive(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(CONFIG.driveTimeoutMs),
    });
  } catch (error) {
    throw failures.driveUnreachable(error instanceof Error ? error.message : 'network error');
  }
}

function looksLikeHtml(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('text/html');
}

/** Parse virus-scan interstitial form fields; null if this is a login/404 page. */
export function parseInterstitial(html: string): Record<string, string> | null {
  const fields: Record<string, string> = {};
  const input = /<input[^>]*type="hidden"[^>]*>/gi;

  for (const tag of html.match(input) ?? []) {
    const name = /name="([^"]+)"/i.exec(tag)?.[1];
    const value = /value="([^"]*)"/i.exec(tag)?.[1];
    if (name && value !== undefined) fields[name] = value;
  }

  if (!fields.confirm) {
    const token = /confirm=([\w-]+)/.exec(html)?.[1];
    if (token) fields.confirm = token;
  }

  delete fields.id;
  delete fields.export;
  return Object.keys(fields).length > 0 ? fields : null;
}

export function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      /* fall through */
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}

/**
 * Trust Content-Type only when it is already image/* or video/*;
 * otherwise sniff magic bytes, then filename extension.
 */
export function resolveMimeType(
  header: string | null,
  prefix: Uint8Array,
  fileName: string | null,
): string {
  const declared = (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (classify(declared)) return declared;

  const sniffed = sniff(prefix);
  if (sniffed) return sniffed;

  const byExtension = fromExtension(fileName);
  if (byExtension) return byExtension;

  return declared || 'application/octet-stream';
}

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mpeg: 'video/mpeg',
};

function fromExtension(fileName: string | null): string | null {
  const ext = fileName?.split('.').pop()?.toLowerCase();
  return (ext && EXTENSION_TYPES[ext]) ?? null;
}

export function sniff(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i] ?? -1;
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...Array.from(bytes.slice(start, start + length)));

  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 4) === 'RIFF') {
    const form = ascii(8, 4);
    if (form === 'WEBP') return 'image/webp';
    if (form === 'AVI ') return 'video/x-msvideo';
  }
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return 'video/webm';
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand.startsWith('qt')) return 'video/quicktime';
    if (brand.startsWith('hei') || brand.startsWith('mif')) return 'image/heic';
    return 'video/mp4';
  }
  return null;
}

export function classify(mimeType: string): MediaKind | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return null;
}

/** Peek magic bytes, then return a stream that still starts at byte 0. */
export async function peek(
  source: ReadableStream<Uint8Array>,
  wanted: number,
): Promise<{ prefix: Uint8Array; stream: ReadableStream<Uint8Array> }> {
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let collected = 0;

  while (collected < wanted) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      chunks.push(value);
      collected += value.byteLength;
    }
  }

  const prefix = concat(chunks).slice(0, wanted);

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (chunks.length > 0) {
        controller.enqueue(chunks.shift()!);
        return;
      }
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      if (value) controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return { prefix, stream };
}

export function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function drain(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw failures.tooLarge(total, limit);
    }
    chunks.push(value);
  }

  return concat(chunks);
}

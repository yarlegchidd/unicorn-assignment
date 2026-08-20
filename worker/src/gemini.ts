import { CONFIG } from './config';
import { Failure, failures } from './failures';

export type MediaPart =
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { mime_type: string; file_uri: string } };

export interface UploadedFile {
  name: string;
  uri: string;
}

interface GenerateOptions {
  instructions: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  thinkingLevel: 'minimal' | 'low' | 'high';
}

/** Dating creatives trip default safety; BLOCK_ONLY_HIGH still blocks hard NSFW. */
const SAFETY_SETTINGS = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

export class Gemini {
  readonly #apiKey: string;
  model: string;

  constructor(apiKey: string, model: string) {
    this.#apiKey = apiKey;
    this.model = model;
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'x-goog-api-key': this.#apiKey, ...extra };
  }

  async generate(media: MediaPart, options: GenerateOptions): Promise<unknown> {
    const response = await this.#send(
      `${CONFIG.geminiBase}/models/${this.model}:generateContent`,
      {
        method: 'POST',
        headers: this.#headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [media, { text: options.instructions }] }],
          safetySettings: SAFETY_SETTINGS,
          generationConfig: {
            temperature: 0,
            topP: 0.1,
            candidateCount: 1,
            maxOutputTokens: options.maxOutputTokens,
            responseMimeType: 'application/json',
            responseSchema: options.schema,
            thinkingConfig: { thinkingLevel: options.thinkingLevel },
          },
        }),
      },
    );

    return readCandidate(await response.json());
  }

  async upload(bytes: Uint8Array, mimeType: string, displayName: string): Promise<UploadedFile> {
    const handshake = await this.#send(`${CONFIG.geminiUploadBase}/files`, {
      method: 'POST',
      headers: this.#headers({
        'content-type': 'application/json',
        'x-goog-upload-protocol': 'resumable',
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(bytes.byteLength),
        'x-goog-upload-header-content-type': mimeType,
      }),
      body: JSON.stringify({ file: { display_name: displayName } }),
    });

    const uploadUrl = handshake.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
      throw failures.geminiUnavailable('upload handshake returned no upload URL');
    }

    const finalize = await this.#send(uploadUrl, {
      method: 'POST',
      headers: {
        'x-goog-upload-offset': '0',
        'x-goog-upload-command': 'upload, finalize',
      },
      body: bytes.slice().buffer as ArrayBuffer,
    });

    const payload = (await finalize.json()) as { file?: { name?: string; uri?: string } };
    const file = payload.file;
    if (!file?.name || !file.uri) {
      throw failures.geminiUnavailable('upload finished without a file handle');
    }
    return { name: file.name, uri: file.uri };
  }

  async waitUntilActive(name: string, onWait?: (elapsedMs: number) => void): Promise<void> {
    const startedAt = Date.now();

    for (let attempt = 0; attempt < CONFIG.filePollAttempts; attempt += 1) {
      const response = await this.#send(`${CONFIG.geminiBase}/${name}`, {
        method: 'GET',
        headers: this.#headers(),
      });
      const file = (await response.json()) as { state?: string; error?: { message?: string } };

      if (file.state === 'ACTIVE') return;
      if (file.state === 'FAILED') {
        throw failures.geminiUnavailable(file.error?.message ?? 'video transcoding failed');
      }

      onWait?.(Date.now() - startedAt);
      await sleep(CONFIG.filePollIntervalMs);
    }

    throw new Failure(
      'gemini_timeout',
      'Gemini is still transcoding this video after 90 seconds.',
      'Try again shortly, or use a shorter clip.',
    );
  }

  async remove(name: string): Promise<void> {
    try {
      await fetch(`${CONFIG.geminiBase}/${name}`, {
        method: 'DELETE',
        headers: this.#headers(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      /* best-effort cleanup */
    }
  }

  async #send(url: string, init: RequestInit): Promise<Response> {
    let lastStatus = 0;
    let lastDetail = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(CONFIG.geminiTimeoutMs) });
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new Failure(
            'gemini_timeout',
            'Gemini did not respond in time.',
            'Retry -- long videos sometimes need a second attempt.',
          );
        }
        lastStatus = 0;
        lastDetail = error instanceof Error ? error.message : 'network error';
        if (attempt === MAX_ATTEMPTS) break;
        await sleep(backoffMs(attempt));
        continue;
      }

      if (response.ok) return response;

      lastStatus = response.status;
      lastDetail = truncate(await response.text().catch(() => ''), 300);

      if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) break;

      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 15_000)
        : backoffMs(attempt);
      await sleep(delay);
    }

    if (lastStatus === 429) throw failures.geminiRateLimited();
    throw failures.geminiUnavailable(
      lastStatus ? `HTTP ${lastStatus}: ${describe(lastDetail)}` : lastDetail,
    );
  }
}

function backoffMs(attempt: number): number {
  return 700 * 2 ** (attempt - 1) + Math.random() * 400;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function describe(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? body;
  } catch {
    return body || 'no details';
  }
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

export function readCandidate(payload: unknown): unknown {
  const response = payload as GenerateContentResponse;

  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) throw failures.geminiRefused(blockReason.toLowerCase());

  const candidate = response.candidates?.[0];
  if (!candidate) throw failures.geminiMalformed('no candidates returned');

  const finish = candidate.finishReason;
  if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'IMAGE_SAFETY') {
    throw failures.geminiRefused(finish.toLowerCase());
  }
  if (finish === 'MAX_TOKENS') {
    throw failures.geminiMalformed('the answer was cut off before the JSON closed');
  }
  if (finish === 'RECITATION') {
    throw failures.geminiRefused('recitation');
  }

  const text = (candidate.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  if (!text) throw failures.geminiMalformed('the response contained no text');

  try {
    return JSON.parse(stripFence(text));
  } catch {
    throw failures.geminiMalformed('the response was not valid JSON');
  }
}

function stripFence(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return fenced?.[1] ?? text;
}

/** Chunked btoa — avoids String.fromCharCode argument limits on large buffers. */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

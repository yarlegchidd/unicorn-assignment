import type { AnalysisResult, ApiFailure, BatchEvent, StreamEvent } from './types';

/**
 * Empty in dev (Vite proxies /api to the local Worker) and set at build time
 * for Pages, where the frontend and the Worker live on different origins.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function previewUrl(driveUrl: string): string {
  return `${API_BASE}/api/preview?src=${encodeURIComponent(driveUrl)}`;
}

export class AnalysisError extends Error {
  readonly failure: ApiFailure;
  constructor(failure: ApiFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

const OFFLINE: ApiFailure = {
  code: 'network_error',
  message: 'Could not reach the analysis API.',
  hint: 'Check your connection, then try again.',
};

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AnalysisError(OFFLINE);
  }

  // Failures caught before the stream opens arrive as a normal JSON error.
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: ApiFailure } | null;
    throw new AnalysisError(payload?.error ?? OFFLINE);
  }
  if (!response.body) throw new AnalysisError(OFFLINE);
  return response;
}

/**
 * Reads a newline-delimited JSON body, dispatching one event at a time rather
 * than waiting for a response that can take a minute on a long video.
 */
async function readNdjson<T>(response: Response, onEvent: (event: T) => void): Promise<void> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  const dispatch = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onEvent(JSON.parse(trimmed) as T);
    } catch {
      /* a half-written line is not worth failing the run over */
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;

      // The last fragment may be a partial line; leave it in the buffer.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) dispatch(line);
    }

    // A well-behaved producer terminates the last event with a newline, but a
    // stream that simply ends still carries a complete final line.
    dispatch(buffer);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

interface AnalyzeOptions {
  onProgress: (event: StreamEvent & { event: 'progress' }) => void;
  signal?: AbortSignal;
}

export async function analyze(
  url: string,
  { onProgress, signal }: AnalyzeOptions,
): Promise<AnalysisResult> {
  const response = await post('/api/analyze', { url }, signal);

  let result: AnalysisResult | null = null;
  let failure: ApiFailure | null = null;

  await readNdjson<StreamEvent>(response, (event) => {
    if (event.event === 'progress') onProgress(event);
    if (event.event === 'complete') result = event.result;
    if (event.event === 'failed') failure = event.error;
  });

  if (failure) throw new AnalysisError(failure);
  if (!result) throw new AnalysisError(INTERRUPTED);
  return result;
}

/**
 * Batch runs on a single connection. Concurrency is the server's business, so
 * the client just relays events as they land — they arrive interleaved and out
 * of order, tagged with the index of the creative they belong to.
 */
export async function analyzeBatch(
  urls: string[],
  { onEvent, signal }: { onEvent: (event: BatchEvent) => void; signal?: AbortSignal },
): Promise<void> {
  const response = await post('/api/analyze/batch', { urls }, signal);

  let finished = false;
  await readNdjson<BatchEvent>(response, (event) => {
    if (event.event === 'done') finished = true;
    onEvent(event);
  });

  if (!finished) throw new AnalysisError(INTERRUPTED);
}

const INTERRUPTED: ApiFailure = {
  code: 'stream_interrupted',
  message: 'The analysis stopped before returning a result.',
  hint: 'Try again — this is usually a dropped connection.',
};

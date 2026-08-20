import type { Env } from './config';
import type { Failure } from './failures';

/** Public by default; set ALLOWED_ORIGINS to restrict. */
export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const configured = (env.ALLOWED_ORIGINS ?? '*').trim();
  const origin = request.headers.get('origin');

  let allowOrigin = '*';
  if (configured !== '*') {
    const allowed = configured.split(',').map((entry) => entry.trim());
    allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] ?? '*';
  }

  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  });
}

export function failureResponse(
  failure: Failure,
  headers: Record<string, string>,
): Response {
  return json({ error: failure.toPayload() }, failure.status, headers);
}

/** NDJSON stream — EventSource cannot POST, so SSE framing buys nothing. */
export class NdjsonStream {
  readonly readable: ReadableStream;
  readonly #writer: WritableStreamDefaultWriter;
  readonly #encoder = new TextEncoder();
  #closed = false;

  constructor() {
    const { readable, writable } = new TransformStream();
    this.readable = readable;
    this.#writer = writable.getWriter();
  }

  async send(event: unknown): Promise<void> {
    if (this.#closed) return;
    try {
      await this.#writer.write(this.#encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      this.#closed = true;
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.#writer.close();
    } catch {
      /* already closed */
    }
  }

  response(headers: Record<string, string>): Response {
    return new Response(this.readable, {
      headers: {
        ...headers,
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      },
    });
  }
}

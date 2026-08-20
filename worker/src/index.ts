import { CONFIG, type Env } from './config';
import { extractFileId } from './drive';
import { asFailure, failures, Failure } from './failures';
import { corsHeaders, failureResponse, json, NdjsonStream } from './http';
import { analyzeCreative, runPool } from './pipeline';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      switch (route) {
        case 'GET /':
        case 'GET /api/health':
          return json(
            { ok: true, service: 'creativescope-api', models: CONFIG.modelsFor(env) },
            200,
            cors,
          );

        case 'POST /api/analyze':
          return await handleAnalyze(request, env, ctx, cors);

        case 'POST /api/analyze/batch':
          return await handleBatch(request, env, ctx, cors);

        case 'GET /api/preview':
          return await handlePreview(request, url, ctx, cors);

        default:
          return failureResponse(failures.notFound(), cors);
      }
    } catch (error) {
      console.error('unhandled', error);
      return failureResponse(asFailure(error), cors);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleAnalyze(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  cors: Record<string, string>,
): Promise<Response> {
  if (!env.GEMINI_API_KEY) return failureResponse(missingKey(), cors);

  let link: string;
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body?.url !== 'string' || body.url.trim() === '') {
      throw failures.badRequest(
        'Request body must contain a non-empty "url".',
        'Send {"url": "https://drive.google.com/file/d/FILE_ID/view"}.',
      );
    }
    link = body.url.trim();
  } catch (error) {
    const failure = error instanceof Failure
      ? error
      : failures.badRequest('Request body was not valid JSON.', 'Send a JSON object with a "url".');
    return failureResponse(failure, cors);
  }

  try {
    extractFileId(link);
  } catch (error) {
    return failureResponse(asFailure(error), cors);
  }

  const stream = new NdjsonStream();

  ctx.waitUntil(
    (async () => {
      try {
        const result = await analyzeCreative(link, env, ctx, (event) => {
          void stream.send({ event: 'progress', ...event });
        });
        await stream.send({ event: 'complete', result });
      } catch (error) {
        const failure = asFailure(error);
        if (failure.code === 'internal') console.error('analysis failed', error);
        await stream.send({ event: 'failed', error: failure.toPayload() });
      } finally {
        await stream.close();
      }
    })(),
  );

  return stream.response(cors);
}

function missingKey(): Failure {
  return failures.badRequest(
    'The Worker has no Gemini API key configured.',
    'Set it with: npx wrangler secret put GEMINI_API_KEY',
  );
}

/**
 * Batch analysis over one connection.
 *
 * The concurrency pool lives here rather than in the browser on purpose: the
 * scarce resource is the Gemini quota, which every open tab shares, so the
 * server is the only place that can cap it meaningfully. Every event carries
 * the index of the creative it belongs to, and one failing creative never
 * stops the rest.
 */
async function handleBatch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  cors: Record<string, string>,
): Promise<Response> {
  if (!env.GEMINI_API_KEY) return failureResponse(missingKey(), cors);

  let urls: string[];
  try {
    const body = (await request.json()) as { urls?: unknown };
    if (!Array.isArray(body?.urls)) {
      throw failures.badRequest(
        'Request body must contain a "urls" array.',
        'Send {"urls": ["https://drive.google.com/file/d/FILE_ID/view", ...]}.',
      );
    }

    // Deduplicated here as well as in the client, because the API is public.
    urls = [
      ...new Set(
        body.urls
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ];

    if (urls.length === 0) {
      throw failures.badRequest(
        'No usable URLs in the request.',
        'Include at least one Drive link.',
      );
    }
    if (urls.length > CONFIG.batchLimit) {
      throw failures.badRequest(
        `A batch holds at most ${CONFIG.batchLimit} creatives, got ${urls.length}.`,
        'Split the list and run it in two passes.',
      );
    }
  } catch (error) {
    const failure =
      error instanceof Failure
        ? error
        : failures.badRequest(
            'Request body was not valid JSON.',
            'Send a JSON object with a "urls" array.',
          );
    return failureResponse(failure, cors);
  }

  const stream = new NdjsonStream();

  ctx.waitUntil(
    (async () => {
      await stream.send({
        event: 'queued',
        concurrency: CONFIG.batchConcurrency,
        items: urls.map((url, id) => ({ id, url })),
      });

      let succeeded = 0;
      let failed = 0;

      await runPool(urls, CONFIG.batchConcurrency, async (url, id) => {
        try {
          const result = await analyzeCreative(url, env, ctx, (event) => {
            void stream.send({ event: 'progress', id, ...event });
          });
          succeeded += 1;
          await stream.send({ event: 'complete', id, result });
        } catch (error) {
          const failure = asFailure(error);
          if (failure.code === 'internal') console.error('batch item failed', error);
          failed += 1;
          await stream.send({ event: 'failed', id, error: failure.toPayload() });
        }
      });

      await stream.send({
        event: 'done',
        summary: { total: urls.length, succeeded, failed },
      });
      await stream.close();
    })(),
  );

  return stream.response(cors);
}

/** Proxies Drive bytes with Range support so <video> seeking works. */
async function handlePreview(
  request: Request,
  url: URL,
  ctx: ExecutionContext,
  cors: Record<string, string>,
): Promise<Response> {
  const src = url.searchParams.get('src');
  if (!src) {
    return failureResponse(
      failures.badRequest('Missing "src" parameter.', 'Pass the Drive link as ?src=...'),
      cors,
    );
  }

  let fileId: string;
  try {
    fileId = extractFileId(src);
  } catch (error) {
    return failureResponse(asFailure(error), cors);
  }

  const upstream = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  const cacheKey = new Request(`https://preview.internal/${fileId}`);
  const cache = caches.default;

  const range = request.headers.get('range');
  if (!range) {
    const hit = await cache.match(cacheKey).catch(() => undefined);
    if (hit) return withPreviewHeaders(hit, cors);
  }

  const response = await fetch(upstream, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      ...(range ? { range } : {}),
    },
    redirect: 'follow',
  });

  if (!response.ok && response.status !== 206) {
    return failureResponse(failures.driveUnreachable(`HTTP ${response.status}`), cors);
  }

  const decorated = withPreviewHeaders(response, cors);
  if (!range && response.status === 200) {
    ctx.waitUntil(cache.put(cacheKey, decorated.clone()).catch(() => undefined));
  }
  return decorated;
}

function withPreviewHeaders(response: Response, cors: Record<string, string>): Response {
  const headers = new Headers();
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = response.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set('accept-ranges', headers.get('accept-ranges') ?? 'bytes');
  headers.set('cache-control', 'public, max-age=3600');
  headers.set('content-disposition', 'inline');
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);

  return new Response(response.body, { status: response.status, headers });
}

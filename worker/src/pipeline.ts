import { CONFIG, type Env } from './config';
import { drain, openDriveFile, type DriveFile } from './drive';
import { Failure } from './failures';
import { Gemini, toBase64, type MediaPart } from './gemini';
import {
  ANALYSIS_INSTRUCTIONS,
  ANALYSIS_SCHEMA,
  TRANSCRIPT_ONLY_INSTRUCTIONS,
  TRANSCRIPT_SCHEMA,
} from './instructions';
import {
  needsTranscriptSalvage,
  normalize,
  normalizeSpeech,
  type AnalysisResult,
  type AnalysisSource,
} from './normalize';

/** Bump when prompt/schema/normaliser semantics change so KV entries go stale. */
const REVISION = 'r1';

export type Step =
  | 'resolving'
  | 'fetching'
  | 'staging'
  | 'transcoding'
  | 'reading'
  | 'transcribing';

export interface ProgressEvent {
  step: Step;
  detail?: string;
}

export type Emit = (event: ProgressEvent) => void;

/**
 * Runs `task` over `items` with at most `limit` in flight, preserving nothing
 * about order — each item reports itself as it finishes, which is the whole
 * point of streaming a batch.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await task(items[index]!, index);
    }
  });

  await Promise.all(lanes);
}

export async function analyzeCreative(
  url: string,
  env: Env,
  ctx: ExecutionContext,
  emit: Emit,
): Promise<AnalysisResult> {
  const startedAt = Date.now();
  const models = CONFIG.modelsFor(env);
  const gemini = new Gemini(env.GEMINI_API_KEY, models[0]!);

  emit({ step: 'resolving' });
  emit({ step: 'fetching', detail: 'Pulling the file from Google Drive' });
  const file = await openDriveFile(url);

  const cacheKey = `analysis:${REVISION}:${models[0]}:${file.fileId}`;
  const cached = await readCache(env, cacheKey);
  if (cached) {
    await file.body.cancel();
    return { ...cached, meta: { ...cached.meta, cached: true, elapsedMs: Date.now() - startedAt } };
  }

  const bytes = await drain(file.body, CONFIG.maxBytes);
  const source: AnalysisSource = {
    fileId: file.fileId,
    fileName: file.fileName,
    mimeType: file.mimeType,
    kind: file.kind,
    byteSize: bytes.byteLength,
  };

  const { part, uploadedName } = await stage(gemini, file, bytes, emit);
  const passes: string[] = [];

  try {
    emit({
      step: 'reading',
      detail:
        file.kind === 'video'
          ? 'Gemini is watching the clip and listening to the audio'
          : 'Gemini is reading the frame',
    });

    const { raw, model } = await generateAcrossModels(
      gemini,
      models,
      part,
      {
        instructions: ANALYSIS_INSTRUCTIONS,
        schema: ANALYSIS_SCHEMA,
        maxOutputTokens: 8192,
        thinkingLevel: 'low',
      },
      emit,
    );
    passes.push('analysis');

    let result = normalize({
      raw,
      source,
      model,
      passes,
      elapsedMs: Date.now() - startedAt,
    });

    if (needsTranscriptSalvage(result)) {
      result = await salvageTranscript(gemini, part, result, passes, emit);
    }

    result.meta.elapsedMs = Date.now() - startedAt;
    ctx.waitUntil(writeCache(env, cacheKey, result));
    return result;
  } finally {
    if (uploadedName) ctx.waitUntil(gemini.remove(uploadedName));
  }
}

/** Fall through on capacity errors only; safety/malformed would just repeat. */
async function generateAcrossModels(
  gemini: Gemini,
  models: string[],
  part: MediaPart,
  options: Parameters<Gemini['generate']>[1],
  emit: Emit,
): Promise<{ raw: unknown; model: string }> {
  let lastError: unknown;

  for (const [index, model] of models.entries()) {
    if (index > 0) {
      console.warn(`falling back to ${model}`);
      emit({ step: 'reading', detail: `Primary model is busy — retrying on ${model}` });
    }

    try {
      gemini.model = model;
      return { raw: await gemini.generate(part, options), model };
    } catch (error) {
      const transient =
        error instanceof Failure &&
        (error.code === 'gemini_unavailable' || error.code === 'gemini_rate_limited');
      if (!transient) throw error;
      lastError = error;
    }
  }

  throw lastError;
}

/** Small images inline; larger media and all video go through Files API. */
async function stage(
  gemini: Gemini,
  file: DriveFile,
  bytes: Uint8Array,
  emit: Emit,
): Promise<{ part: MediaPart; uploadedName: string | null }> {
  const inlineable = file.kind === 'image' && bytes.byteLength <= CONFIG.inlineLimitBytes;

  if (inlineable) {
    return {
      part: { inline_data: { mime_type: file.mimeType, data: toBase64(bytes) } },
      uploadedName: null,
    };
  }

  emit({ step: 'staging', detail: 'Uploading the file to Gemini' });
  // Neutral display name — Drive filenames often encode the ground-truth tags.
  const uploaded = await gemini.upload(bytes, file.mimeType, `creative-${file.fileId}`);

  emit({ step: 'transcoding', detail: 'Gemini is preparing the video' });
  await gemini.waitUntilActive(uploaded.name, (elapsedMs) => {
    emit({
      step: 'transcoding',
      detail: `Gemini is preparing the video (${Math.round(elapsedMs / 1000)}s)`,
    });
  });

  return {
    part: { file_data: { mime_type: file.mimeType, file_uri: uploaded.uri } },
    uploadedName: uploaded.name,
  };
}

/** Second audio-only pass when speech was flagged but transcript came back empty. */
async function salvageTranscript(
  gemini: Gemini,
  part: MediaPart,
  result: AnalysisResult,
  passes: string[],
  emit: Emit,
): Promise<AnalysisResult> {
  emit({ step: 'transcribing', detail: 'Re-running the audio pass to recover the transcript' });

  try {
    const raw = await gemini.generate(part, {
      instructions: TRANSCRIPT_ONLY_INSTRUCTIONS,
      schema: TRANSCRIPT_SCHEMA,
      maxOutputTokens: 8192,
      thinkingLevel: 'minimal',
    });
    passes.push('transcript-retry');

    const speech = normalizeSpeech((raw ?? {}) as Record<string, unknown>, 'video');
    return { ...result, speech, meta: { ...result.meta, passes } };
  } catch (error) {
    if (error instanceof Failure) {
      console.warn('transcript salvage failed', error.code, error.message);
    }
    passes.push('transcript-retry-failed');
    return {
      ...result,
      speech: { ...result.speech, detected: false },
      meta: { ...result.meta, passes },
    };
  }
}

async function readCache(env: Env, key: string): Promise<AnalysisResult | null> {
  if (!env.ANALYSIS_CACHE) return null;
  try {
    return await env.ANALYSIS_CACHE.get<AnalysisResult>(key, 'json');
  } catch {
    return null;
  }
}

async function writeCache(env: Env, key: string, result: AnalysisResult): Promise<void> {
  if (!env.ANALYSIS_CACHE) return;
  try {
    await env.ANALYSIS_CACHE.put(key, JSON.stringify({ ...result, meta: { ...result.meta } }), {
      expirationTtl: CONFIG.cacheTtlSeconds,
    });
  } catch (error) {
    console.warn('cache write failed', error);
  }
}

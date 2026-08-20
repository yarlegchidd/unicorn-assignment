export interface Env {
  GEMINI_API_KEY: string;
  ALLOWED_ORIGINS?: string;
  /** Optional model override without redeploying. */
  GEMINI_MODEL?: string;
  /** Optional — see wrangler.jsonc. */
  ANALYSIS_CACHE?: KVNamespace;
}

export const CONFIG = {
  maxBytes: 60 * 1024 * 1024,
  /** Inline base64 cutoff; Gemini caps ~20 MB and base64 expands 4/3. */
  inlineLimitBytes: 13 * 1024 * 1024,
  model: 'gemini-3.7-flash',
  /** Used when the primary returns capacity errors. */
  fallbackModels: ['gemini-3.6-flash', 'gemini-flash-latest'],

  modelsFor(env: Env): string[] {
    const primary = env.GEMINI_MODEL?.trim() || CONFIG.model;
    return [primary, ...CONFIG.fallbackModels.filter((name) => name !== primary)];
  },

  geminiBase: 'https://generativelanguage.googleapis.com/v1beta',
  geminiUploadBase: 'https://generativelanguage.googleapis.com/upload/v1beta',

  driveTimeoutMs: 60_000,
  geminiTimeoutMs: 180_000,
  filePollIntervalMs: 2_000,
  filePollAttempts: 45,
  cacheTtlSeconds: 60 * 60 * 24 * 7,

  /** Most batches a marketer pastes are a campaign's worth, not a library. */
  batchLimit: 12,

  /**
   * Concurrency is capped here rather than in the browser because the scarce
   * resource is the Gemini quota, which is shared by every open tab. Three is
   * the point where six creatives finish in roughly the time of two without
   * tripping per-minute rate limits.
   */
  batchConcurrency: 3,
} as const;

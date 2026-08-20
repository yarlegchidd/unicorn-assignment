export type MediaKind = 'image' | 'video';
export type Confidence = 'high' | 'medium' | 'low';

export type Step =
  | 'resolving'
  | 'fetching'
  | 'staging'
  | 'transcoding'
  | 'reading'
  | 'transcribing';

export interface SubjectAttributes {
  ethnicity: string | null;
  gender: string | null;
  ageBand: string | null;
  activity: string | null;
  hairColor: string | null;
  build: string | null;
  outfit: string | null;
}

export interface AnalysisResult {
  source: {
    fileId: string;
    fileName: string | null;
    mimeType: string;
    kind: MediaKind;
    byteSize: number | null;
  };
  sceneSummary: string | null;
  subject: {
    present: boolean;
    attributes: SubjectAttributes | null;
    confidence: Confidence | null;
    note: string | null;
  };
  speech: {
    detected: boolean;
    language: string | null;
    transcript: string | null;
  };
  meta: {
    model: string;
    passes: string[];
    elapsedMs: number;
    cached: boolean;
  };
}

export interface ApiFailure {
  code: string;
  message: string;
  hint: string;
}

export type StreamEvent =
  | { event: 'progress'; step: Step; detail?: string }
  | { event: 'complete'; result: AnalysisResult }
  | { event: 'failed'; error: ApiFailure };

export type BatchEvent =
  | { event: 'queued'; concurrency: number; items: Array<{ id: number; url: string }> }
  | { event: 'progress'; id: number; step: Step; detail?: string }
  | { event: 'complete'; id: number; result: AnalysisResult }
  | { event: 'failed'; id: number; error: ApiFailure }
  | { event: 'done'; summary: { total: number; succeeded: number; failed: number } };

/** One row of a batch, as the UI tracks it. */
export interface BatchItem {
  id: number;
  url: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  step?: Step;
  detail?: string;
  result?: AnalysisResult;
  error?: ApiFailure;
}

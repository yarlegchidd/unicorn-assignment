import type { MediaKind } from './drive';
import {
  ATTRIBUTE_FIELDS,
  ATTRIBUTE_VOCABULARY,
  CONFIDENCE,
  type Confidence,
  type SubjectAttributes,
} from './taxonomy';

export interface AnalysisSource {
  fileId: string;
  fileName: string | null;
  mimeType: string;
  kind: MediaKind;
  byteSize: number | null;
}

export interface Speech {
  detected: boolean;
  language: string | null;
  transcript: string | null;
}

export interface AnalysisResult {
  source: AnalysisSource;
  sceneSummary: string | null;
  subject: {
    present: boolean;
    attributes: SubjectAttributes | null;
    confidence: Confidence | null;
    note: string | null;
  };
  speech: Speech;
  meta: {
    model: string;
    passes: string[];
    elapsedMs: number;
    cached: boolean;
  };
}

const SYNONYMS: Record<string, string> = {
  caucasian: 'multiethnic',
  white: 'multiethnic',
  european: 'multiethnic',
  mixed: 'multiethnic',
  hispanic: 'latina',
  latino: 'latina',
  latinx: 'latina',
  'african american': 'black',
  'middle aged': 'middle-aged',
  middleaged: 'middle-aged',
  adult: 'middle-aged',
  senior: 'older',
  elderly: 'older',
  man: 'male',
  woman: 'female',
  blond: 'blonde',
  grey: 'gray',
  silver: 'gray',
  brunette: 'brown',
  auburn: 'red',
  fit: 'athletic',
  muscular: 'athletic',
  plus_size: 'heavy',
  'plus size': 'heavy',
  overweight: 'heavy',
  thin: 'slim',
  normal: 'average',
  bikini: 'swimwear',
  underwear: 'lingerie',
  activewear: 'sporty',
  athleisure: 'sporty',
  business: 'formal',
  streetwear: 'casual',
  'selfie video': 'selfie',
};

const NULLISH = new Set(['', 'null', 'none', 'n/a', 'na', 'unknown', 'undefined', '-']);

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (NULLISH.has(key)) return null;
  const resolved = SYNONYMS[key] ?? key;
  return (allowed as readonly string[]).includes(resolved) ? (resolved as T) : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return NULLISH.has(trimmed.toLowerCase()) ? null : trimmed;
}

function flag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

function attributes(raw: unknown): SubjectAttributes | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const draft: SubjectAttributes = {
    ethnicity: pick(record.ethnicity, ATTRIBUTE_VOCABULARY.ethnicity),
    gender: pick(record.gender, ATTRIBUTE_VOCABULARY.gender),
    ageBand: pick(record.ageBand, ATTRIBUTE_VOCABULARY.ageBand),
    activity: pick(record.activity, ATTRIBUTE_VOCABULARY.activity),
    hairColor: pick(record.hairColor, ATTRIBUTE_VOCABULARY.hairColor),
    build: pick(record.build, ATTRIBUTE_VOCABULARY.build),
    outfit: pick(record.outfit, ATTRIBUTE_VOCABULARY.outfit),
  };

  return ATTRIBUTE_FIELDS.some((field) => draft[field] !== null) ? draft : null;
}

function language(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(raw)) return raw;
  return raw.length <= 24 ? raw : null;
}

export interface NormalizeInput {
  raw: unknown;
  source: AnalysisSource;
  model: string;
  passes: string[];
  elapsedMs: number;
  cached?: boolean;
}

export function normalize({
  raw,
  source,
  model,
  passes,
  elapsedMs,
  cached = false,
}: NormalizeInput): AnalysisResult {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const parsed = attributes(record.subject);
  const present = flag(record.subjectPresent) || parsed !== null;

  return {
    source,
    sceneSummary: text(record.sceneSummary),
    subject: {
      present,
      attributes: present ? parsed : null,
      confidence: present ? pick(record.subjectConfidence, CONFIDENCE) : null,
      note: present ? text(record.subjectNote) : null,
    },
    speech: normalizeSpeech(record, source.kind),
    meta: { model, passes, elapsedMs, cached },
  };
}

/** Images never carry speech — pin audio fields even if the model hallucinates. */
export function normalizeSpeech(record: Record<string, unknown>, kind: MediaKind): Speech {
  if (kind === 'image') return { detected: false, language: null, transcript: null };

  const transcript = text(record.transcript);
  const detected = transcript !== null ? true : flag(record.speechDetected);

  return {
    detected,
    language: detected ? language(record.speechLanguage) : null,
    transcript,
  };
}

export function needsTranscriptSalvage(result: AnalysisResult): boolean {
  return (
    result.source.kind === 'video' &&
    result.speech.detected &&
    (result.speech.transcript === null || result.speech.transcript.length < 2)
  );
}

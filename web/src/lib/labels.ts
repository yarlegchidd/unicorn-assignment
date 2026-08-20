import type { Step, SubjectAttributes } from './types';

export const ATTRIBUTE_ROWS: Array<{ key: keyof SubjectAttributes; label: string }> = [
  { key: 'ethnicity', label: 'Ethnicity' },
  { key: 'gender', label: 'Gender' },
  { key: 'ageBand', label: 'Age' },
  { key: 'activity', label: 'Activity' },
  { key: 'hairColor', label: 'Hair colour' },
  { key: 'build', label: 'Body type' },
  { key: 'outfit', label: 'Clothing' },
];

export const STEP_SEQUENCE: Step[] = [
  'resolving',
  'fetching',
  'staging',
  'transcoding',
  'reading',
  'transcribing',
];

export const STEP_LABELS: Record<Step, string> = {
  resolving: 'Reading the link',
  fetching: 'Downloading from Drive',
  staging: 'Uploading to Gemini',
  transcoding: 'Preparing the video',
  reading: 'Analysing',
  transcribing: 'Recovering the transcript',
};

export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const DISPLAY_NAMES =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;

export function languageName(tag: string | null): string | null {
  if (!tag) return null;
  try {
    return DISPLAY_NAMES?.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

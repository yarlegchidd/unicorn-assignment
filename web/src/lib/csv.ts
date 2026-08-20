import { ATTRIBUTE_ROWS } from './labels';
import type { BatchItem } from './types';

const COLUMNS = [
  'url',
  'file',
  'type',
  'status',
  ...ATTRIBUTE_ROWS.map((row) => row.key),
  'confidence',
  'note',
  'scene',
  'speechLanguage',
  'transcript',
  'model',
  'error',
] as const;

function escape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Excel and Sheets both need the quote-doubling form; newlines inside a
  // quoted field are legal and keep multi-sentence transcripts on one row.
  return /["\n,]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Batch output as a spreadsheet, because that is where these tags actually go.
 * Failed rows are kept rather than dropped — a marketer needs to see which
 * creative did not make it, not a silently shorter list.
 */
export function toCsv(items: BatchItem[]): string {
  const rows = items.map((item) => {
    const result = item.result;
    const attributes = result?.subject.attributes;

    return [
      item.url,
      result?.source.fileName ?? '',
      result?.source.kind ?? '',
      item.status,
      ...ATTRIBUTE_ROWS.map((row) => attributes?.[row.key] ?? ''),
      result?.subject.confidence ?? '',
      result?.subject.note ?? '',
      result?.sceneSummary ?? '',
      result?.speech.language ?? '',
      result?.speech.transcript ?? '',
      result?.meta.model ?? '',
      item.error ? `${item.error.code}: ${item.error.message}` : '',
    ].map(escape).join(',');
  });

  return [COLUMNS.join(','), ...rows].join('\n');
}

export function download(filename: string, contents: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: `${mimeType};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

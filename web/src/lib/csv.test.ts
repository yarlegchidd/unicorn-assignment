import { describe, expect, it } from 'vitest';
import { IMAGE_RESULT, VIDEO_RESULT } from '../test-fixtures';
import { toCsv } from './csv';
import type { BatchItem } from './types';

const done = (id: number, result: typeof IMAGE_RESULT): BatchItem => ({
  id,
  url: `https://drive.google.com/file/d/${id}/view`,
  status: 'done',
  result,
});

function rows(csv: string): string[] {
  return csv.split('\n');
}

describe('toCsv', () => {
  it('writes a header plus one row per creative', () => {
    const csv = toCsv([done(0, IMAGE_RESULT), done(1, VIDEO_RESULT)]);
    const [header, ...body] = rows(csv);

    expect(header).toContain('ethnicity');
    expect(header).toContain('transcript');
    expect(body).toHaveLength(2);
  });

  it('lays the seven attributes out as columns', () => {
    const csv = toCsv([done(0, IMAGE_RESULT)]);
    expect(rows(csv)[1]).toContain('asian,male,young,hugging,black,athletic,casual');
  });

  it('keeps failed creatives visible instead of dropping them', () => {
    const csv = toCsv([
      done(0, IMAGE_RESULT),
      {
        id: 1,
        url: 'https://drive.google.com/file/d/1x/view',
        status: 'failed',
        error: { code: 'drive_forbidden', message: 'Sign-in page.', hint: 'Fix sharing.' },
      },
    ]);

    expect(rows(csv)).toHaveLength(3);
    expect(csv).toContain('drive_forbidden: Sign-in page.');
  });

  it('quotes fields containing commas, quotes or newlines', () => {
    const csv = toCsv([
      {
        ...done(0, {
          ...VIDEO_RESULT,
          speech: {
            detected: true,
            language: 'en',
            transcript: 'She said "hello", then left.\nHe did not.',
          },
        }),
      },
    ]);

    expect(csv).toContain('"She said ""hello"", then left.\nHe did not."');
  });

  it('leaves cells empty when no person was detected', () => {
    const csv = toCsv([
      done(0, {
        ...IMAGE_RESULT,
        subject: { present: false, attributes: null, confidence: null, note: null },
      }),
    ]);

    expect(rows(csv)[1]).toContain(',,,,,,,');
  });
});

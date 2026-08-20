import { describe, expect, it } from 'vitest';
import { readCandidate } from '../src/gemini';
import { needsTranscriptSalvage, normalize, type AnalysisSource } from '../src/normalize';

const IMAGE: AnalysisSource = {
  fileId: 'abc',
  fileName: 'creative.jpg',
  mimeType: 'image/jpeg',
  kind: 'image',
  byteSize: 1024,
};

const VIDEO: AnalysisSource = { ...IMAGE, fileName: 'clip.mp4', mimeType: 'video/mp4', kind: 'video' };

const shape = (raw: unknown, source = IMAGE) =>
  normalize({ raw, source, model: 'gemini-2.5-flash', passes: ['analysis'], elapsedMs: 10 });

const FULL_SUBJECT = {
  ethnicity: 'latina',
  gender: 'female',
  ageBand: 'young',
  activity: 'dancing',
  hairColor: 'brown',
  build: 'slim',
  outfit: 'dress',
};

describe('normalize', () => {
  it('passes a clean answer straight through', () => {
    const result = shape({
      sceneSummary: 'A woman dances in a kitchen.',
      subjectPresent: true,
      subject: FULL_SUBJECT,
      subjectConfidence: 'high',
      subjectNote: null,
    });

    expect(result.subject.present).toBe(true);
    expect(result.subject.attributes).toEqual(FULL_SUBJECT);
    expect(result.subject.confidence).toBe('high');
    expect(result.sceneSummary).toBe('A woman dances in a kitchen.');
  });

  it('maps off-vocabulary answers onto the taxonomy', () => {
    const result = shape({
      subjectPresent: true,
      subject: {
        ethnicity: 'Caucasian',
        gender: 'Woman',
        ageBand: 'middle aged',
        activity: 'POSING',
        hairColor: 'blond',
        build: 'muscular',
        outfit: 'bikini',
      },
    });

    expect(result.subject.attributes).toEqual({
      ethnicity: 'multiethnic',
      gender: 'female',
      ageBand: 'middle-aged',
      activity: 'posing',
      hairColor: 'blonde',
      build: 'athletic',
      outfit: 'swimwear',
    });
  });

  it('blanks a single unrecognisable field instead of the whole subject', () => {
    const result = shape({
      subjectPresent: true,
      subject: { ...FULL_SUBJECT, hairColor: 'iridescent teal' },
    });

    expect(result.subject.attributes?.hairColor).toBeNull();
    expect(result.subject.attributes?.gender).toBe('female');
  });

  it('reports an empty subject when nobody is in focus', () => {
    const result = shape({ subjectPresent: false, subject: null, sceneSummary: 'An empty beach.' });

    expect(result.subject.present).toBe(false);
    expect(result.subject.attributes).toBeNull();
    expect(result.subject.confidence).toBeNull();
  });

  it('believes the attributes over a contradictory subjectPresent flag', () => {
    const result = shape({ subjectPresent: false, subject: FULL_SUBJECT });
    expect(result.subject.present).toBe(true);
  });

  it('never reports speech on a still image', () => {
    const result = shape({
      subjectPresent: false,
      subject: null,
      speechDetected: true,
      speechLanguage: 'en',
      transcript: 'Hello there',
    });

    expect(result.speech).toEqual({ detected: false, language: null, transcript: null });
  });

  it('keeps a non-English transcript untouched', () => {
    const result = shape(
      {
        subjectPresent: true,
        subject: FULL_SUBJECT,
        speechDetected: true,
        speechLanguage: 'uk',
        transcript: 'Привіт, я шукаю когось особливого.',
      },
      VIDEO,
    );

    expect(result.speech.transcript).toBe('Привіт, я шукаю когось особливого.');
    expect(result.speech.language).toBe('uk');
  });

  it('treats placeholder strings as absent', () => {
    const result = shape(
      { subjectPresent: false, subject: null, speechDetected: true, transcript: 'N/A' },
      VIDEO,
    );

    expect(result.speech.transcript).toBeNull();
  });

  it('trusts a transcript that arrives with the flag unset', () => {
    const result = shape(
      { subjectPresent: false, subject: null, speechDetected: false, transcript: 'Call her now.' },
      VIDEO,
    );

    expect(result.speech.detected).toBe(true);
  });

  it('survives a completely empty payload', () => {
    const result = shape({});
    expect(result.subject.present).toBe(false);
    expect(result.sceneSummary).toBeNull();
  });
});

describe('needsTranscriptSalvage', () => {
  it('fires when a video claims speech but returns nothing', () => {
    const result = shape({ speechDetected: true, transcript: null }, VIDEO);
    expect(needsTranscriptSalvage(result)).toBe(true);
  });

  it('stays quiet when the transcript is there', () => {
    const result = shape({ speechDetected: true, transcript: 'Some words.' }, VIDEO);
    expect(needsTranscriptSalvage(result)).toBe(false);
  });

  it('stays quiet for images', () => {
    expect(needsTranscriptSalvage(shape({ speechDetected: true, transcript: null }))).toBe(false);
  });
});

describe('readCandidate', () => {
  const wrap = (text: string) => ({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
  });

  it('parses the JSON payload', () => {
    expect(readCandidate(wrap('{"subjectPresent":true}'))).toEqual({ subjectPresent: true });
  });

  it('unwraps a markdown fence the model added anyway', () => {
    expect(readCandidate(wrap('```json\n{"subjectPresent":false}\n```'))).toEqual({
      subjectPresent: false,
    });
  });

  it('surfaces a prompt-level safety block', () => {
    expect(() => readCandidate({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(
      /declined to analyse/i,
    );
  });

  it('surfaces a candidate-level safety block', () => {
    expect(() => readCandidate({ candidates: [{ finishReason: 'SAFETY' }] })).toThrowError(
      expect.objectContaining({ code: 'gemini_refused' }),
    );
  });

  it('calls out a truncated answer specifically', () => {
    expect(() => readCandidate({ candidates: [{ finishReason: 'MAX_TOKENS' }] })).toThrowError(
      expect.objectContaining({ code: 'gemini_malformed' }),
    );
  });

  it('rejects prose that is not JSON', () => {
    expect(() => readCandidate(wrap('I cannot help with that.'))).toThrowError(
      expect.objectContaining({ code: 'gemini_malformed' }),
    );
  });
});

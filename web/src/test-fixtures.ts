import type { AnalysisResult } from './lib/types';

export const IMAGE_RESULT: AnalysisResult = {
  source: {
    fileId: '1abc',
    fileName: 'couple.png',
    mimeType: 'image/png',
    kind: 'image',
    byteSize: 2_400_000,
  },
  sceneSummary: 'A man and a woman embrace on a busy street.',
  subject: {
    present: true,
    attributes: {
      ethnicity: 'asian',
      gender: 'male',
      ageBand: 'young',
      activity: 'hugging',
      hairColor: 'black',
      build: 'athletic',
      outfit: 'casual',
    },
    confidence: 'high',
    note: null,
  },
  speech: { detected: false, language: null, transcript: null },
  meta: { model: 'gemini-3.7-flash', passes: ['analysis'], elapsedMs: 4200, cached: false },
};

export const VIDEO_RESULT: AnalysisResult = {
  source: {
    fileId: '1def',
    fileName: 'talking.mp4',
    mimeType: 'video/mp4',
    kind: 'video',
    byteSize: 14_000_000,
  },
  sceneSummary: 'A woman speaks to camera from a car.',
  subject: {
    present: true,
    attributes: {
      ethnicity: 'multiethnic',
      gender: 'female',
      ageBand: 'middle-aged',
      activity: 'talking',
      hairColor: 'blonde',
      build: 'average',
      outfit: 'casual',
    },
    confidence: 'high',
    note: null,
  },
  speech: {
    detected: true,
    language: 'en',
    transcript: 'Hello from the video.',
  },
  meta: { model: 'gemini-3.7-flash', passes: ['analysis'], elapsedMs: 18_000, cached: false },
};

export const EMPTY_SUBJECT: AnalysisResult = {
  ...IMAGE_RESULT,
  sceneSummary: 'An empty room with a phone on the table.',
  subject: { present: false, attributes: null, confidence: null, note: null },
};

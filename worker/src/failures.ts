export type FailureCode =
  | 'bad_request'
  | 'not_a_drive_link'
  | 'drive_unreachable'
  | 'drive_forbidden'
  | 'media_type_unsupported'
  | 'media_too_large'
  | 'gemini_unavailable'
  | 'gemini_rate_limited'
  | 'gemini_refused'
  | 'gemini_malformed'
  | 'gemini_timeout'
  | 'not_found'
  | 'internal';

export interface FailurePayload {
  code: FailureCode;
  message: string;
  hint: string;
}

const STATUS: Record<FailureCode, number> = {
  bad_request: 400,
  not_a_drive_link: 400,
  drive_unreachable: 502,
  drive_forbidden: 403,
  media_type_unsupported: 415,
  media_too_large: 413,
  gemini_unavailable: 502,
  gemini_rate_limited: 429,
  gemini_refused: 422,
  gemini_malformed: 502,
  gemini_timeout: 504,
  not_found: 404,
  internal: 500,
};

export class Failure extends Error {
  readonly code: FailureCode;
  readonly hint: string;

  constructor(code: FailureCode, message: string, hint: string) {
    super(message);
    this.name = 'Failure';
    this.code = code;
    this.hint = hint;
  }

  get status(): number {
    return STATUS[this.code];
  }

  toPayload(): FailurePayload {
    return { code: this.code, message: this.message, hint: this.hint };
  }
}

/** Map unknown throws to Failure without leaking stack traces to the client. */
export function asFailure(error: unknown): Failure {
  if (error instanceof Failure) return error;

  if (error instanceof Error && error.name === 'AbortError') {
    return new Failure(
      'gemini_timeout',
      'The analysis took longer than the time budget allows.',
      'Retry -- long videos occasionally need a second attempt.',
    );
  }

  return new Failure(
    'internal',
    'Something went wrong while analysing this creative.',
    'Retry in a moment. If it keeps happening, check the Worker logs.',
  );
}

export const failures = {
  badRequest: (message: string, hint: string) => new Failure('bad_request', message, hint),

  notADriveLink: () =>
    new Failure(
      'not_a_drive_link',
      'That URL is not a Google Drive file link.',
      'Paste a link that looks like https://drive.google.com/file/d/FILE_ID/view.',
    ),

  driveUnreachable: (detail: string) =>
    new Failure(
      'drive_unreachable',
      `Google Drive did not return the file (${detail}).`,
      'Check that the file still exists, then try again.',
    ),

  driveForbidden: () =>
    new Failure(
      'drive_forbidden',
      'Google Drive served a sign-in page instead of the file.',
      'Open the file in Drive and set sharing to "Anyone with the link".',
    ),

  unsupportedMedia: (mimeType: string) =>
    new Failure(
      'media_type_unsupported',
      `This file is ${mimeType}, which is neither an image nor a video.`,
      'Only image and video creatives can be analysed.',
    ),

  tooLarge: (bytes: number, limit: number) =>
    new Failure(
      'media_too_large',
      `The file is ${formatBytes(bytes)}, above the ${formatBytes(limit)} limit.`,
      'Trim the clip or export it at a lower bitrate before analysing.',
    ),

  geminiUnavailable: (detail: string) =>
    new Failure(
      'gemini_unavailable',
      `Gemini returned an error (${detail}).`,
      'This is usually transient -- retry in a few seconds.',
    ),

  geminiRateLimited: () =>
    new Failure(
      'gemini_rate_limited',
      'Gemini is rate limiting this API key.',
      'Wait a minute before analysing the next creative, or raise the quota.',
    ),

  geminiRefused: (reason: string) =>
    new Failure(
      'gemini_refused',
      `Gemini declined to analyse this creative (${reason}).`,
      'The safety filter blocked it. Nothing to fix on our side.',
    ),

  geminiMalformed: (detail: string) =>
    new Failure(
      'gemini_malformed',
      `Gemini replied with something we could not read (${detail}).`,
      'Retry -- the model occasionally breaks its own output contract.',
    ),

  notFound: () =>
    new Failure('not_found', 'No such endpoint.', 'Check the path and HTTP method.'),
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

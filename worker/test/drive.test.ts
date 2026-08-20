import { describe, expect, it } from 'vitest';
import {
  drain,
  extractFileId,
  fileNameFromDisposition,
  parseInterstitial,
  peek,
  resolveMimeType,
  sniff,
} from '../src/drive';
import { Failure } from '../src/failures';

const FILE_ID = '1vd8C8tLUnZo4-rfozcQ_oDGqVc4ZRW3W';

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('extractFileId', () => {
  it.each([
    `https://drive.google.com/file/d/${FILE_ID}/view`,
    `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`,
    `https://drive.google.com/open?id=${FILE_ID}`,
    `https://drive.google.com/uc?export=download&id=${FILE_ID}`,
    `https://drive.usercontent.google.com/download?id=${FILE_ID}&export=download`,
    `  https://drive.google.com/file/d/${FILE_ID}/view  `,
    FILE_ID,
  ])('accepts %s', (input) => {
    expect(extractFileId(input)).toBe(FILE_ID);
  });

  it.each([
    'https://example.com/file/d/abc/view',
    'https://drive.google.com/drive/my-drive',
    'not a url at all',
    '',
  ])('rejects %s', (input) => {
    expect(() => extractFileId(input)).toThrow(Failure);
  });

  it('reports a link problem rather than a generic error', () => {
    try {
      extractFileId('https://dropbox.com/x');
      expect.unreachable();
    } catch (error) {
      expect((error as Failure).code).toBe('not_a_drive_link');
    }
  });
});

describe('parseInterstitial', () => {
  it('collects the hidden fields of the virus-scan form', () => {
    const html = `
      <form id="download-form" action="https://drive.usercontent.google.com/download">
        <input type="hidden" name="id" value="${FILE_ID}">
        <input type="hidden" name="export" value="download">
        <input type="hidden" name="confirm" value="t">
        <input type="hidden" name="uuid" value="9f0c-4c11">
      </form>`;

    // id and export are always re-added by the caller, so they are dropped here.
    expect(parseInterstitial(html)).toEqual({ confirm: 't', uuid: '9f0c-4c11' });
  });

  it('falls back to a confirm token in a link', () => {
    const html = '<a href="/uc?export=download&confirm=AbC1&id=x">Download anyway</a>';
    expect(parseInterstitial(html)).toEqual({ confirm: 'AbC1' });
  });

  it('returns null for a sign-in wall', () => {
    expect(parseInterstitial('<html><body>Sign in to continue</body></html>')).toBeNull();
  });
});

describe('sniff', () => {
  const cases: Array<[string, number[]]> = [
    ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]],
    ['image/gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ['video/webm', [0x1a, 0x45, 0xdf, 0xa3]],
  ];

  it.each(cases)('detects %s', (expected, bytes) => {
    expect(sniff(new Uint8Array(bytes))).toBe(expected);
  });

  it('detects mp4 from the ftyp box', () => {
    const bytes = new Uint8Array(16);
    bytes.set([...'ftyp'].map((c) => c.charCodeAt(0)), 4);
    bytes.set([...'isom'].map((c) => c.charCodeAt(0)), 8);
    expect(sniff(bytes)).toBe('video/mp4');
  });

  it('separates webp from avi inside a RIFF container', () => {
    const riff = (form: string) => {
      const bytes = new Uint8Array(12);
      bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
      bytes.set([...form].map((c) => c.charCodeAt(0)), 8);
      return bytes;
    };
    expect(sniff(riff('WEBP'))).toBe('image/webp');
    expect(sniff(riff('AVI '))).toBe('video/x-msvideo');
  });

  it('returns null for unrecognised bytes', () => {
    expect(sniff(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe('resolveMimeType', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const noise = new Uint8Array([0x00, 0x01]);

  it('trusts a concrete media header', () => {
    expect(resolveMimeType('image/png; charset=binary', jpeg, null)).toBe('image/png');
  });

  it('sniffs past application/octet-stream, which Drive loves to send', () => {
    expect(resolveMimeType('application/octet-stream', jpeg, null)).toBe('image/jpeg');
  });

  it('falls back to the filename extension when bytes are inconclusive', () => {
    expect(resolveMimeType('application/octet-stream', noise, 'promo.mov')).toBe('video/quicktime');
  });

  it('keeps the declared type when nothing else resolves', () => {
    expect(resolveMimeType('application/pdf', noise, 'brief.pdf')).toBe('application/pdf');
  });
});

describe('fileNameFromDisposition', () => {
  it('reads the plain filename', () => {
    expect(fileNameFromDisposition('attachment; filename="clip.mp4"')).toBe('clip.mp4');
  });

  it('prefers the percent-encoded UTF-8 form', () => {
    const header = `attachment; filename="creative.mp4"; filename*=UTF-8''%D0%BA%D0%BB%D1%96%D0%BF.mp4`;
    expect(fileNameFromDisposition(header)).toBe('кліп.mp4');
  });

  it('returns null when absent', () => {
    expect(fileNameFromDisposition(null)).toBeNull();
  });
});

describe('peek', () => {
  it('reads a prefix without consuming the stream', async () => {
    const source = streamOf(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]));
    const { prefix, stream } = await peek(source, 4);

    expect(Array.from(prefix)).toEqual([1, 2, 3, 4]);
    expect(Array.from(await drain(stream, 1024))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('copes with a stream shorter than the requested prefix', async () => {
    const { prefix, stream } = await peek(streamOf(new Uint8Array([7])), 32);
    expect(Array.from(prefix)).toEqual([7]);
    expect((await drain(stream, 1024)).byteLength).toBe(1);
  });
});

describe('drain', () => {
  it('rejects a stream that outgrows the limit', async () => {
    const source = streamOf(new Uint8Array(64), new Uint8Array(64));
    await expect(drain(source, 100)).rejects.toMatchObject({ code: 'media_too_large' });
  });
});

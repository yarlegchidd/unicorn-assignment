import { describe, expect, it, vi } from 'vitest';
import { analyze, AnalysisError } from './api';
import { IMAGE_RESULT } from '../test-fixtures';

function ndjsonResponse(lines: string[], init: ResponseInit = { status: 200 }): Response {
  const body = lines.map((line) => `${line}\n`).join('');
  return new Response(body, {
    ...init,
    headers: { 'content-type': 'application/x-ndjson', ...(init.headers ?? {}) },
  });
}

describe('analyze', () => {
  it('dispatches progress events and returns the completed result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ndjsonResponse([
        JSON.stringify({ event: 'progress', step: 'fetching' }),
        JSON.stringify({ event: 'complete', result: IMAGE_RESULT }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const onProgress = vi.fn();
    const result = await analyze('https://drive.google.com/file/d/1abc/view', { onProgress });

    expect(result.source.fileId).toBe('1abc');
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'progress', step: 'fetching' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/analyze',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws AnalysisError when the stream reports failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ndjsonResponse([
          JSON.stringify({
            event: 'failed',
            error: {
              code: 'gemini_rate_limited',
              message: 'rate limited',
              hint: 'wait',
            },
          }),
        ]),
      ),
    );

    await expect(
      analyze('https://drive.google.com/file/d/1abc/view', { onProgress: vi.fn() }),
    ).rejects.toBeInstanceOf(AnalysisError);
  });
});

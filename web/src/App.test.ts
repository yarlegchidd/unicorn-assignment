import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_RESULT, VIDEO_RESULT } from './test-fixtures';

vi.mock('./lib/api', async () => {
  class AnalysisError extends Error {
    failure: { code: string; message: string; hint: string };
    constructor(failure: { code: string; message: string; hint: string }) {
      super(failure.message);
      this.failure = failure;
    }
  }
  return {
    analyze: vi.fn(),
    analyzeBatch: vi.fn(),
    AnalysisError,
    previewUrl: (url: string) => `/api/preview?src=${encodeURIComponent(url)}`,
    API_BASE: '',
  };
});

import App from './App.svelte';
import { analyze, analyzeBatch } from './lib/api';

const mockedAnalyze = vi.mocked(analyze);
const mockedBatch = vi.mocked(analyzeBatch);

describe('App', () => {
  beforeEach(() => {
    mockedAnalyze.mockReset();
    mockedBatch.mockReset();
    localStorage.clear();
  });

  it('rejects a non-Drive URL without calling the API', async () => {
    const user = userEvent.setup();
    render(App);

    await user.type(screen.getByLabelText(/google drive link/i), 'https://example.com/file');
    await user.click(screen.getByRole('button', { name: /^analyse$/i }));

    expect(await screen.findByText(/does not look like a google drive link/i)).toBeInTheDocument();
    expect(mockedAnalyze).not.toHaveBeenCalled();
  });

  it('runs analysis and shows attributes on success', async () => {
    mockedAnalyze.mockImplementation(async (_url, { onProgress }) => {
      onProgress({ event: 'progress', step: 'fetching', detail: 'Pulling the file' });
      onProgress({ event: 'progress', step: 'reading' });
      return IMAGE_RESULT;
    });

    const user = userEvent.setup();
    render(App);

    await user.type(
      screen.getByLabelText(/google drive link/i),
      'https://drive.google.com/file/d/1abc/view',
    );
    await user.click(screen.getByRole('button', { name: /^analyse$/i }));

    expect(await screen.findByText('asian')).toBeInTheDocument();
    expect(screen.getByText('athletic')).toBeInTheDocument();
    expect(screen.getByText(/still image/i)).toBeInTheDocument();
    expect(mockedAnalyze).toHaveBeenCalledOnce();
  });

  it('shows transcript for a video result', async () => {
    mockedAnalyze.mockResolvedValue(VIDEO_RESULT);

    const user = userEvent.setup();
    render(App);

    await user.type(
      screen.getByLabelText(/google drive link/i),
      'https://drive.google.com/file/d/1def/view',
    );
    await user.click(screen.getByRole('button', { name: /^analyse$/i }));

    expect(await screen.findByText('Hello from the video.')).toBeInTheDocument();
  });

  it('shows a failure notice when the API errors', async () => {
    const { AnalysisError } = await import('./lib/api');
    mockedAnalyze.mockRejectedValue(
      new AnalysisError({
        code: 'drive_forbidden',
        message: 'Google Drive served a sign-in page instead of the file.',
        hint: 'Open the file in Drive and set sharing to "Anyone with the link".',
      }),
    );

    const user = userEvent.setup();
    render(App);

    await user.type(
      screen.getByLabelText(/google drive link/i),
      'https://drive.google.com/file/d/1abc/view',
    );
    await user.click(screen.getByRole('button', { name: /^analyse$/i }));

    expect(await screen.findByText(/sign-in page/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('shows progress while analysis is running', async () => {
    let release!: (value: typeof IMAGE_RESULT) => void;
    mockedAnalyze.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const user = userEvent.setup();
    render(App);

    await user.type(
      screen.getByLabelText(/google drive link/i),
      'https://drive.google.com/file/d/1abc/view',
    );
    await user.click(screen.getByRole('button', { name: /^analyse$/i }));

    expect(await screen.findByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByText(/analysing/i)).toBeInTheDocument();

    release(IMAGE_RESULT);
    await waitFor(() => expect(screen.getByText('asian')).toBeInTheDocument());
  });

  describe('batch', () => {
    const TWO = [
      'https://drive.google.com/file/d/1abc/view',
      'https://drive.google.com/file/d/1def/view',
    ].join('\n');

    async function submit(text: string) {
      const user = userEvent.setup();
      render(App);
      const field = screen.getByLabelText(/google drive link/i);
      // Enter submits, so paste rather than type a multi-line value.
      await user.click(field);
      await user.paste(text);
      await user.click(screen.getByRole('button', { name: /^analyse/i }));
      return user;
    }

    it('switches to the batch endpoint for more than one link', async () => {
      mockedBatch.mockResolvedValue(undefined);
      await submit(TWO);

      expect(mockedBatch).toHaveBeenCalledOnce();
      expect(mockedBatch.mock.calls[0]![0]).toEqual([
        'https://drive.google.com/file/d/1abc/view',
        'https://drive.google.com/file/d/1def/view',
      ]);
      expect(mockedAnalyze).not.toHaveBeenCalled();
    });

    it('deduplicates repeated links before sending', async () => {
      mockedBatch.mockResolvedValue(undefined);
      const repeated = 'https://drive.google.com/file/d/1abc/view';
      await submit(`${repeated}\n${repeated}\nhttps://drive.google.com/file/d/1def/view`);

      expect(mockedBatch.mock.calls[0]![0]).toHaveLength(2);
    });

    it('renders each row as its event arrives, successes and failures alike', async () => {
      mockedBatch.mockImplementation(async (_urls, { onEvent }) => {
        onEvent({
          event: 'queued',
          concurrency: 3,
          items: [
            { id: 0, url: 'https://drive.google.com/file/d/1abc/view' },
            { id: 1, url: 'https://drive.google.com/file/d/1def/view' },
          ],
        });
        onEvent({ event: 'progress', id: 0, step: 'reading' });
        onEvent({ event: 'complete', id: 0, result: IMAGE_RESULT });
        onEvent({
          event: 'failed',
          id: 1,
          error: { code: 'drive_forbidden', message: 'Sign-in page.', hint: 'Fix sharing.' },
        });
        onEvent({ event: 'done', summary: { total: 2, succeeded: 1, failed: 1 } });
      });

      await submit(TWO);

      expect(await screen.findByText('2 creatives')).toBeInTheDocument();
      expect(await screen.findByText('couple.png')).toBeInTheDocument();
      expect(screen.getByText('Sign-in page.')).toBeInTheDocument();
      expect(screen.getByText(/1 analysed, 1 failed/i)).toBeInTheDocument();
    });

    it('expands a finished row into the full detail view', async () => {
      mockedBatch.mockImplementation(async (_urls, { onEvent }) => {
        onEvent({ event: 'complete', id: 0, result: VIDEO_RESULT });
        onEvent({ event: 'complete', id: 1, result: IMAGE_RESULT });
        onEvent({ event: 'done', summary: { total: 2, succeeded: 2, failed: 0 } });
      });

      const user = await submit(TWO);
      const row = await screen.findByRole('button', { name: /talking\.mp4/i });

      expect(screen.queryByText('Hello from the video.')).not.toBeInTheDocument();
      await user.click(row);
      expect(await screen.findByText('Hello from the video.')).toBeInTheDocument();
    });

    it('offers an export once at least one creative has settled', async () => {
      mockedBatch.mockImplementation(async (_urls, { onEvent }) => {
        onEvent({ event: 'complete', id: 0, result: IMAGE_RESULT });
        onEvent({ event: 'done', summary: { total: 2, succeeded: 1, failed: 0 } });
      });

      await submit(TWO);
      expect(await screen.findByRole('button', { name: /download csv/i })).toBeInTheDocument();
    });
  });
});

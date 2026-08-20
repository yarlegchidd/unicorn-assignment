import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FailureNotice from './FailureNotice.svelte';

describe('FailureNotice', () => {
  it('hides retry for permanent failures', () => {
    render(FailureNotice, {
      props: {
        failure: {
          code: 'drive_forbidden',
          message: 'Google Drive served a sign-in page.',
          hint: 'Set sharing to Anyone with the link.',
        },
        onretry: vi.fn(),
      },
    });
    expect(screen.getByText(/sign-in page/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('offers retry for transient failures', async () => {
    const onretry = vi.fn();
    render(FailureNotice, {
      props: {
        failure: {
          code: 'gemini_rate_limited',
          message: 'Gemini is rate limiting this API key.',
          hint: 'Wait a minute.',
        },
        onretry,
      },
    });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onretry).toHaveBeenCalledOnce();
  });
});

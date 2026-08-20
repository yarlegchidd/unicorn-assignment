import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LinkForm from './LinkForm.svelte';

const LINK = 'https://drive.google.com/file/d/1abc/view';

function mount(overrides: Record<string, unknown> = {}) {
  const props = {
    value: LINK,
    busy: false,
    error: null,
    count: 1,
    limit: 12,
    onsubmit: vi.fn(),
    oncancel: vi.fn(),
    onchange: vi.fn(),
    ...overrides,
  };
  render(LinkForm, { props });
  return props;
}

describe('LinkForm', () => {
  it('submits the current value', async () => {
    const { onsubmit } = mount();
    await userEvent.click(screen.getByRole('button', { name: /^analyse$/i }));
    expect(onsubmit).toHaveBeenCalledWith(LINK);
  });

  it('fills a sample creative into the field', async () => {
    const { onchange } = mount({ value: '', count: 0 });
    await userEvent.click(screen.getByRole('button', { name: '#1' }));
    expect(onchange).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/drive\.google\.com\/file\/d\//),
    );
  });

  it('loads all six briefed creatives at once', async () => {
    const { onchange } = mount({ value: '', count: 0 });
    await userEvent.click(screen.getByRole('button', { name: /all six/i }));
    expect(onchange.mock.calls[0]![0].split('\n')).toHaveLength(6);
  });

  it('names the batch size on the button', () => {
    mount({ count: 6 });
    expect(screen.getByRole('button', { name: 'Analyse 6' })).toBeInTheDocument();
  });

  it('blocks submission past the batch limit', () => {
    mount({ count: 14, limit: 12 });
    expect(screen.getByRole('button', { name: /^analyse/i })).toBeDisabled();
    expect(screen.getByText(/at most 12/i)).toBeInTheDocument();
  });

  it('shows cancel while busy', () => {
    mount({ busy: true });
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /^analyse$/i })).toHaveLength(0);
  });
});

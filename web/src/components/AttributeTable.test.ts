import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import AttributeTable from './AttributeTable.svelte';
import { EMPTY_SUBJECT, IMAGE_RESULT } from '../test-fixtures';

describe('AttributeTable', () => {
  it('renders attribute tags when a subject is present', () => {
    render(AttributeTable, { props: { result: IMAGE_RESULT } });
    expect(screen.getByText('Person in frame')).toBeInTheDocument();
    expect(screen.getByText('asian')).toBeInTheDocument();
    expect(screen.getByText('athletic')).toBeInTheDocument();
    expect(screen.getByText('high confidence')).toBeInTheDocument();
  });

  it('shows an empty-state note when no subject is present', () => {
    render(AttributeTable, { props: { result: EMPTY_SUBJECT } });
    expect(screen.getByText(/no person is in focus/i)).toBeInTheDocument();
  });
});

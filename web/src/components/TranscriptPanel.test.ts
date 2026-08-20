import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import TranscriptPanel from './TranscriptPanel.svelte';
import { IMAGE_RESULT, VIDEO_RESULT } from '../test-fixtures';

describe('TranscriptPanel', () => {
  it('renders the transcript for a video with speech', () => {
    render(TranscriptPanel, { props: { result: VIDEO_RESULT } });
    expect(screen.getByText('Hello from the video.')).toBeInTheDocument();
  });

  it('notes that still images have no audio', () => {
    render(TranscriptPanel, { props: { result: IMAGE_RESULT } });
    expect(screen.getByText(/still image/i)).toBeInTheDocument();
  });

  it('notes when a video has no speech', () => {
    render(TranscriptPanel, {
      props: {
        result: {
          ...VIDEO_RESULT,
          speech: { detected: false, language: null, transcript: null },
        },
      },
    });
    expect(screen.getByText(/no speech in this video/i)).toBeInTheDocument();
  });
});

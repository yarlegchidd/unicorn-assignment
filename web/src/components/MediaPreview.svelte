<script lang="ts">
  import { previewUrl } from '../lib/api';
  import { formatBytes } from '../lib/labels';
  import type { AnalysisResult } from '../lib/types';

  interface Props {
    result: AnalysisResult;
    sourceUrl: string;
  }

  let { result, sourceUrl }: Props = $props();
  let broken = $state(false);

  let src = $derived(previewUrl(sourceUrl));
  let size = $derived(formatBytes(result.source.byteSize));
</script>

<section class="card preview">
  <div class="frame">
    {#if broken}
      <p class="fallback">
        Preview unavailable.
        <a href={sourceUrl} target="_blank" rel="noreferrer">Open in Google Drive</a>
      </p>
    {:else if result.source.kind === 'video'}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video {src} controls preload="metadata" onerror={() => (broken = true)}></video>
    {:else}
      <img {src} alt="Creative being analysed" onerror={() => (broken = true)} />
    {/if}
  </div>

  <div class="filemeta">
    <span class="name">{result.source.fileName ?? result.source.fileId}</span>
    <span>{size ? `${result.source.mimeType} · ${size}` : result.source.mimeType}</span>
  </div>
</section>

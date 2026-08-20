<script lang="ts">
  import { STEP_LABELS } from '../lib/labels';
  import type { BatchItem } from '../lib/types';
  import AttributeTable from './AttributeTable.svelte';
  import MediaPreview from './MediaPreview.svelte';
  import TranscriptPanel from './TranscriptPanel.svelte';

  interface Props {
    item: BatchItem;
    onretry: (url: string) => void;
  }

  let { item, onretry }: Props = $props();

  // Collapsed by default: rendering N videos at once would pull every clip
  // through the proxy for a page the marketer mostly scans.
  let open = $state(false);

  let attributes = $derived(item.result?.subject.attributes);
  let chips = $derived(
    attributes
      ? [attributes.ethnicity, attributes.gender, attributes.ageBand, attributes.activity].filter(
          (value): value is string => Boolean(value),
        )
      : [],
  );
  let label = $derived(item.result?.source.fileName ?? item.url.replace(/^https?:\/\//, ''));
</script>

<li class="row card" class:open>
  <button
    type="button"
    class="row-head"
    aria-expanded={open}
    disabled={item.status === 'queued' || item.status === 'running'}
    onclick={() => (open = !open)}
  >
    <span class="row-index">{item.id + 1}</span>

    <span class="row-body">
      <span class="row-title">{label}</span>

      {#if item.status === 'done' && item.result}
        <span class="row-tags">
          {#if chips.length > 0}
            {#each chips as chip (chip)}<span class="tag">{chip}</span>{/each}
          {:else}
            <span class="row-muted">no person in focus</span>
          {/if}
          {#if item.result.speech.transcript}
            <span class="row-muted">· speech ({item.result.speech.language ?? '??'})</span>
          {/if}
        </span>
      {:else if item.status === 'failed'}
        <span class="row-muted row-bad">{item.error?.message}</span>
      {:else if item.status === 'running'}
        <span class="row-muted">{item.step ? STEP_LABELS[item.step] : 'Starting'}…</span>
      {:else}
        <span class="row-muted">Waiting for a free slot</span>
      {/if}
    </span>

    <span class="row-state">
      {#if item.status === 'running'}
        <span class="dot active"></span>
      {:else if item.status === 'done'}
        <span class="chevron">{open ? '−' : '+'}</span>
      {:else if item.status === 'failed'}
        <span class="row-bad">failed</span>
      {:else}
        <span class="dot"></span>
      {/if}
    </span>
  </button>

  {#if open && item.result}
    <div class="row-detail">
      <MediaPreview result={item.result} sourceUrl={item.url} />
      <div class="stack">
        <AttributeTable result={item.result} />
        <TranscriptPanel result={item.result} />
      </div>
    </div>
  {/if}

  {#if item.status === 'failed' && item.error}
    <div class="row-detail row-detail-flat">
      <p class="note">{item.error.hint}</p>
      <button type="button" class="ghost" onclick={() => onretry(item.url)}>
        Analyse this one on its own
      </button>
    </div>
  {/if}
</li>

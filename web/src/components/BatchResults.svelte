<script lang="ts">
  import { download, toCsv } from '../lib/csv';
  import type { BatchItem } from '../lib/types';
  import BatchRow from './BatchRow.svelte';

  interface Props {
    items: BatchItem[];
    running: boolean;
    onretry: (url: string) => void;
  }

  let { items, running, onretry }: Props = $props();

  let done = $derived(items.filter((item) => item.status === 'done').length);
  let failed = $derived(items.filter((item) => item.status === 'failed').length);
  let settled = $derived(done + failed);
  let exportable = $derived(items.filter((item) => item.status !== 'queued'));

  function saveCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    download(`creativescope-${stamp}.csv`, toCsv(exportable), 'text/csv');
  }

  function saveJson() {
    const payload = exportable.map((item) => ({
      url: item.url,
      status: item.status,
      result: item.result ?? null,
      error: item.error ?? null,
    }));
    download('creativescope.json', JSON.stringify(payload, null, 2), 'application/json');
  }
</script>

<section class="batch">
  <div class="batch-head">
    <div>
      <h2>{items.length} creatives</h2>
      <p class="note">
        {#if running}
          {settled} of {items.length} finished{#if failed > 0}, {failed} failed{/if} — three run at a time
        {:else}
          {done} analysed{#if failed > 0}, {failed} failed{/if}
        {/if}
      </p>
    </div>

    {#if settled > 0}
      <div class="batch-actions">
        <button type="button" class="ghost" onclick={saveCsv}>Download CSV</button>
        <button type="button" class="ghost" onclick={saveJson}>Download JSON</button>
      </div>
    {/if}
  </div>

  <ul class="rows">
    {#each items as item (item.id)}
      <BatchRow {item} {onretry} />
    {/each}
  </ul>
</section>

<script lang="ts">
  interface Props {
    value: string;
    busy: boolean;
    error: string | null;
    /** How many distinct Drive links the parent found in `value`. */
    count: number;
    limit: number;
    onsubmit: (raw: string) => void;
    oncancel: () => void;
    onchange: (raw: string) => void;
  }

  let { value, busy, error, count, limit, onsubmit, oncancel, onchange }: Props = $props();

  /**
   * The six creatives from the brief, so a reviewer can exercise the tool
   * without copying links out of the spec.
   */
  const SAMPLES = [
    '1vd8C8tLUnZo4-rfozcQ_oDGqVc4ZRW3W',
    '1jITp26v4aN8fdWa6lsiQnY4zjo7KEOxe',
    '1RecmQXu2U-p_p1XPGrqRmialbSa63eDx',
    '1eFbqsGVh0zatfhhD94bfU-Yz7ow9uBSL',
    '1e6VM-74qJ4GPIwRS2aPmL0TUKogeSlbT',
    '1hJGB8OQGvEfJL-EsS61IOZzOpoefaDyQ',
  ].map((id) => `https://drive.google.com/file/d/${id}/view`);

  let field = $state<HTMLTextAreaElement | null>(null);

  /**
   * One line until there is more to show. A textarea that starts three rows
   * tall implies batch is the normal case, and it is not.
   */
  function fit() {
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 180)}px`;
  }

  $effect(() => {
    void value;
    fit();
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    onsubmit(value);
  }

  function onKeydown(event: KeyboardEvent) {
    // Enter submits, Shift+Enter adds a line — the opposite of a textarea's
    // default, but this is a form field that happens to wrap.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onsubmit(value);
    }
  }

  let overLimit = $derived(count > limit);
  let action = $derived(count > 1 ? `Analyse ${count}` : 'Analyse');
</script>

<form class="card composer" onsubmit={submit}>
  <div class="field">
    <label class="sr-only" for="drive-url">Google Drive links</label>
    <textarea
      id="drive-url"
      bind:this={field}
      rows="1"
      autocomplete="off"
      spellcheck="false"
      placeholder="https://drive.google.com/file/d/FILE_ID/view — paste several to run a batch"
      bind:value
      oninput={(event) => onchange(event.currentTarget.value)}
      onkeydown={onKeydown}
      disabled={busy}
    ></textarea>

    {#if busy}
      <button type="button" class="primary" onclick={oncancel}>Cancel</button>
    {:else}
      <button type="submit" class="primary" disabled={value.trim() === '' || overLimit}>
        {action}
      </button>
    {/if}
  </div>

  {#if error}
    <p class="inline-error">{error}</p>
  {:else if overLimit}
    <p class="inline-error">{count} links — a batch holds at most {limit}.</p>
  {/if}

  <div class="samples">
    <span>Test creatives:</span>
    {#each SAMPLES as sample, index (sample)}
      <button type="button" class="ghost" disabled={busy} onclick={() => onchange(sample)}>
        #{index + 1}
      </button>
    {/each}
    <button
      type="button"
      class="ghost"
      disabled={busy}
      onclick={() => onchange(SAMPLES.join('\n'))}
    >
      all six
    </button>
  </div>
</form>

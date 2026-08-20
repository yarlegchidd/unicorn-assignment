<script lang="ts">
  import AttributeTable from './components/AttributeTable.svelte';
  import BatchResults from './components/BatchResults.svelte';
  import FailureNotice from './components/FailureNotice.svelte';
  import LinkForm from './components/LinkForm.svelte';
  import MediaPreview from './components/MediaPreview.svelte';
  import ProgressTrail from './components/ProgressTrail.svelte';
  import TranscriptPanel from './components/TranscriptPanel.svelte';
  import { AnalysisError, analyze, analyzeBatch } from './lib/api';
  import { formatDuration } from './lib/labels';
  import type { AnalysisResult, ApiFailure, BatchItem, Step } from './lib/types';

  const HISTORY_KEY = 'creativescope:recent';
  const BATCH_LIMIT = 12;

  let raw = $state('');
  let phase = $state<'idle' | 'running' | 'done' | 'failed'>('idle');
  let trail = $state<Array<{ step: Step; detail?: string }>>([]);
  let result = $state<AnalysisResult | null>(null);
  let batch = $state<BatchItem[]>([]);
  let failure = $state<ApiFailure | null>(null);
  let inlineError = $state<string | null>(null);
  let startedAt = $state(0);
  let analysedUrl = $state('');
  let controller: AbortController | null = null;

  let history = $state<string[]>(loadHistory());

  /**
   * Links can arrive one per line, comma separated, or space separated — people
   * paste out of spreadsheets, chat and the brief itself.
   */
  function parseLinks(input: string): string[] {
    return [...new Set(input.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean))];
  }

  let links = $derived(parseLinks(raw));

  function loadHistory(): string[] {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      return stored ? (JSON.parse(stored) as string[]).slice(0, 6) : [];
    } catch {
      return [];
    }
  }

  function remember(link: string) {
    history = [link, ...history.filter((entry) => entry !== link)].slice(0, 6);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      /* private mode — the history is a convenience, not a feature */
    }
  }

  /**
   * A cheap shape check so an obvious typo never costs a round trip. The Worker
   * validates properly; this only exists to make the mistake instant.
   */
  function looksLikeDriveLink(value: string): boolean {
    return /drive\.google\.com|docs\.google\.com/.test(value) || /^[\w-]{20,}$/.test(value);
  }

  /** Progress arrives repeatedly for the same step; keep one row and refresh it. */
  function record(step: Step, detail?: string) {
    const existing = trail.findIndex((entry) => entry.step === step);
    if (existing === -1) trail = [...trail, { step, detail }];
    else trail = trail.map((entry, index) => (index === existing ? { step, detail } : entry));
  }

  function reset() {
    inlineError = null;
    failure = null;
    result = null;
    batch = [];
    trail = [];
  }

  function start(input: string) {
    const urls = parseLinks(input);
    if (urls.length === 0) return;

    const bad = urls.find((url) => !looksLikeDriveLink(url));
    if (bad) {
      reset();
      phase = 'idle';
      inlineError =
        urls.length > 1
          ? `Not a Google Drive link: ${bad}`
          : 'That does not look like a Google Drive link.';
      return;
    }
    if (urls.length > BATCH_LIMIT) return;

    controller?.abort();
    controller = new AbortController();

    reset();
    startedAt = Date.now();
    phase = 'running';

    void (urls.length === 1 ? runSingle(urls[0]!) : runBatch(urls));
  }

  async function runSingle(url: string) {
    analysedUrl = url;
    try {
      result = await analyze(url, {
        signal: controller!.signal,
        onProgress: (event) => record(event.step, event.detail),
      });
      phase = 'done';
      remember(url);
    } catch (error) {
      handleError(error);
    }
  }

  async function runBatch(urls: string[]) {
    batch = urls.map((url, id) => ({ id, url, status: 'queued' }));

    const patch = (id: number, changes: Partial<BatchItem>) => {
      batch = batch.map((item) => (item.id === id ? { ...item, ...changes } : item));
    };

    try {
      await analyzeBatch(urls, {
        signal: controller!.signal,
        onEvent: (event) => {
          if (event.event === 'progress') {
            patch(event.id, { status: 'running', step: event.step, detail: event.detail });
          } else if (event.event === 'complete') {
            patch(event.id, { status: 'done', result: event.result, step: undefined });
          } else if (event.event === 'failed') {
            patch(event.id, { status: 'failed', error: event.error, step: undefined });
          }
        },
      });
      phase = 'done';
    } catch (error) {
      handleError(error);
    }
  }

  function handleError(error: unknown) {
    if (controller?.signal.aborted) {
      phase = 'idle';
      trail = [];
      return;
    }
    failure =
      error instanceof AnalysisError
        ? error.failure
        : {
            code: 'unexpected',
            message: 'Something went wrong in the browser.',
            hint: 'Reload the page and try again.',
          };
    // Partial batch results are still worth showing next to the error.
    phase = batch.length > 0 ? 'done' : 'failed';
  }

  function cancel() {
    controller?.abort();
    controller = null;
    phase = batch.some((item) => item.status !== 'queued') ? 'done' : 'idle';
    trail = [];
  }

  function setRaw(next: string) {
    raw = next;
    if (inlineError) inlineError = null;
  }

  let rawJson = $derived(result ? JSON.stringify(result, null, 2) : '');
</script>

<main class="shell">
  <div class="masthead">
    <span class="mark" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <line x1="15.6" y1="15.6" x2="20.5" y2="20.5" />
      </svg>
    </span>
    <h1>CreativeScope</h1>
  </div>
  <p class="tagline">
    Paste a public Google Drive link to an ad creative — or several for a batch. Gemini reads the
    frame, tags the person in focus against the media-buying taxonomy, and transcribes any voiceover
    in its original language.
  </p>

  <LinkForm
    value={raw}
    busy={phase === 'running'}
    error={inlineError}
    count={links.length}
    limit={BATCH_LIMIT}
    onchange={setRaw}
    onsubmit={start}
    oncancel={cancel}
  />

  {#if phase === 'running' && batch.length === 0}
    <ProgressTrail {trail} {startedAt} />
  {/if}

  {#if failure}
    <FailureNotice {failure} onretry={() => start(raw)} />
  {/if}

  {#if batch.length > 0}
    <BatchResults items={batch} running={phase === 'running'} onretry={(url) => start(url)} />
  {/if}

  {#if phase === 'done' && result}
    <div class="result">
      <MediaPreview {result} sourceUrl={analysedUrl} />

      <div class="stack">
        <AttributeTable {result} />
        <TranscriptPanel {result} />

        <div class="panel card">
          <div class="meta-row">
            <span>{result.meta.model}</span>
            <span>{formatDuration(result.meta.elapsedMs)}</span>
            <span>{result.meta.passes.join(' + ')}</span>
            {#if result.meta.cached}<span>served from cache</span>{/if}
          </div>
          <details class="raw">
            <summary>Raw JSON</summary>
            <pre>{rawJson}</pre>
          </details>
        </div>
      </div>
    </div>
  {/if}

  {#if phase === 'idle' && history.length > 0}
    <section class="history">
      <h2>Recent</h2>
      <ul>
        {#each history as entry (entry)}
          <li><button type="button" onclick={() => setRaw(entry)}>{entry}</button></li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

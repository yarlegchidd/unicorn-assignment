<script lang="ts">
  import type { ApiFailure } from '../lib/types';

  interface Props {
    failure: ApiFailure;
    onretry: () => void;
  }

  let { failure, onretry }: Props = $props();

  const PERMANENT = new Set([
    'not_a_drive_link',
    'bad_request',
    'drive_forbidden',
    'media_type_unsupported',
    'media_too_large',
    'gemini_refused',
  ]);

  let retryable = $derived(!PERMANENT.has(failure.code));
</script>

<section class="failure" role="alert">
  <h2>{failure.message}</h2>
  <p>{failure.hint}</p>
  <div class="panel-head">
    <span class="code mono">{failure.code}</span>
    {#if retryable}
      <button type="button" class="ghost" onclick={onretry}>Try again</button>
    {/if}
  </div>
</section>

<script lang="ts">
  import { languageName, wordCount } from '../lib/labels';
  import type { AnalysisResult } from '../lib/types';

  interface Props {
    result: AnalysisResult;
  }

  let { result }: Props = $props();
  let copied = $state(false);

  let transcript = $derived(result.speech.transcript);
  let language = $derived(languageName(result.speech.language));

  async function copy() {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }
</script>

<section class="card panel">
  <div class="panel-head">
    <h2>Transcript</h2>
    {#if transcript}
      <div class="panel-head" style="gap: 8px">
        {#if language}<span class="pill">{language}</span>{/if}
        <span class="pill">{wordCount(transcript)} words</span>
        <button type="button" class="ghost" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    {/if}
  </div>

  {#if transcript}
    <p class="transcript">{transcript}</p>
  {:else if result.source.kind === 'image'}
    <p class="hollow">Still image — there is no audio track to transcribe.</p>
  {:else}
    <p class="hollow">
      No speech in this video. The audio is music, ambient sound or silence, so the transcript is
      empty by design.
    </p>
  {/if}
</section>

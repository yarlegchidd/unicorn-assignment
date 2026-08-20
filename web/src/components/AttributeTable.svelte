<script lang="ts">
  import { ATTRIBUTE_ROWS } from '../lib/labels';
  import type { AnalysisResult } from '../lib/types';

  interface Props {
    result: AnalysisResult;
  }

  let { result }: Props = $props();
  let subject = $derived(result.subject);
</script>

<section class="card panel">
  <div class="panel-head">
    <h2>Person in frame</h2>
    {#if subject.present && subject.confidence}
      <span class="pill {subject.confidence}">{subject.confidence} confidence</span>
    {/if}
  </div>

  {#if result.sceneSummary}
    <p class="summary">{result.sceneSummary}</p>
  {/if}

  {#if subject.present && subject.attributes}
    <table class="attributes">
      <tbody>
        {#each ATTRIBUTE_ROWS as row (row.key)}
          {@const value = subject.attributes[row.key]}
          <tr>
            <th scope="row">{row.label}</th>
            {#if value}
              <td><span class="tag">{value}</span></td>
            {:else}
              <td class="blank">not determined</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>

    {#if subject.note}
      <p class="note">Caveat: {subject.note}</p>
    {/if}
  {:else}
    <p class="hollow">
      No person is in focus in this creative, so there is nothing to tag. Any voiceover is still
      transcribed below.
    </p>
  {/if}
</section>

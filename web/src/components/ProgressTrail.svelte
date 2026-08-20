<script lang="ts">
  import { STEP_LABELS } from '../lib/labels';
  import type { Step } from '../lib/types';

  interface Props {
    trail: Array<{ step: Step; detail?: string }>;
    startedAt: number;
  }

  let { trail, startedAt }: Props = $props();

  let now = $state(Date.now());

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 200);
    return () => clearInterval(timer);
  });

  let elapsed = $derived(((now - startedAt) / 1000).toFixed(1));
</script>

<section class="card trail" aria-live="polite">
  <div class="trail-head">
    <h2>Analysing</h2>
    <span class="clock">{elapsed}s</span>
  </div>

  <ol class="steps">
    {#each trail as entry, index (entry.step)}
      <li class={index === trail.length - 1 ? 'active' : 'done'}>
        <span class="dot"></span>
        <span>
          {STEP_LABELS[entry.step]}
          {#if index === trail.length - 1 && entry.detail}
            <span class="step-detail">— {entry.detail}</span>
          {/if}
        </span>
      </li>
    {/each}
  </ol>
</section>

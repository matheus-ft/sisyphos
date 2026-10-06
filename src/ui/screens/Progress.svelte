<script lang="ts">
  import { app } from '../app.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import BodyView from '../progress/BodyView.svelte';
  import LaboursView from '../progress/LaboursView.svelte';
  import StrengthView from '../progress/StrengthView.svelte';
  import type { ProgressView } from '../route';
  import { localDate } from '../session';

  /**
   * Athloi, the Progress tab: the body (muscles by working sets), strength
   * (e1RM as a hill) and labours (the best weight at each rep count). The
   * view is part of the route, so each has its own address.
   */
  interface Props {
    view: ProgressView;
    /** The exercise the route names, as from an exercise's history. */
    exercise?: string;
  }
  let { view, exercise }: Props = $props();

  const VIEWS: { value: ProgressView; label: string }[] = [
    { value: 'body', label: 'Body' },
    { value: 'strength', label: 'Strength' },
    { value: 'labours', label: 'Labours' },
  ];

  const today = localDate(new Date());

  /** The exercise last picked, kept when switching between Strength and Labours. */
  let picked = $state<string | null>(null);
  $effect(() => {
    if (exercise) picked = exercise;
  });
</script>

<ScreenHeader title="Progress" />
<div class="views">
  <Segmented
    options={VIEWS}
    value={view}
    label="View"
    full
    onchange={(next) => app.replace({ name: 'progress', view: next })}
  />
</div>

<section class="pane" aria-label={VIEWS.find((v) => v.value === view)?.label}>
  {#if view === 'body'}
    <BodyView {today} />
  {:else if view === 'strength'}
    <StrengthView {today} {picked} onpick={(id) => (picked = id)} />
  {:else}
    <LaboursView {today} {picked} onpick={(id) => (picked = id)} />
  {/if}
</section>

<style>
  .views {
    padding: 0 var(--gutter);
  }

  .pane {
    padding-bottom: var(--space-6);
  }
</style>

<script lang="ts">
  import { app } from '../app.svelte';
  import EmptyState from '../kit/EmptyState.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import type { ProgressView } from '../route';

  /**
   * Athloi, the Progress tab: the body (muscles by working sets), strength
   * (e1RM as a hill) and labours (the best weight at each rep count). The
   * view is part of the route, so each has its own address.
   */
  interface Props {
    view: ProgressView;
  }
  let { view }: Props = $props();

  const VIEWS: { value: ProgressView; label: string }[] = [
    { value: 'body', label: 'Body' },
    { value: 'strength', label: 'Strength' },
    { value: 'labours', label: 'Labours' },
  ];
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
  <!-- Placeholders until each view is built: they say so rather than claim there is no data. -->
  {#if view === 'body'}
    <EmptyState
      title="The body is not drawn yet"
      line="Its muscles will shade by this week's working sets."
    />
  {:else if view === 'strength'}
    <EmptyState
      title="The strength hill is not drawn yet"
      line="Each lift's best e1RM over time, drawn as the hill the boulder climbs."
    />
  {:else}
    <EmptyState
      title="The labours are not listed yet"
      line="Each exercise's best weight at 1 to 10 reps."
    />
  {/if}
</section>

<style>
  .views {
    padding: 0 var(--gutter);
  }

  .pane {
    margin-top: var(--space-4);
  }
</style>

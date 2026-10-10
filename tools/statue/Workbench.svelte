<script lang="ts">
  import { STATUE_ART } from '../../src/ui/progress/statue-art';
  import Statue from '../../src/ui/progress/Statue.svelte';
  import { REDRAW_FRONT } from './redraw';

  /**
   * The statue workbench: the app's statue beside a drawing under study,
   * painted by the app's own component so only the drawing differs, with a
   * week's training shaded on both. Not part of the app (vite serves it in dev,
   * the build leaves it out); `npm run statue` opens it, `npm run statue:shots`
   * photographs it.
   */

  /** A plausible week: pressing and squatting heavy, little arm work. */
  const LEVELS = new Map<string, number>([
    ['pecs', 4],
    ['front_delts', 3],
    ['triceps', 2],
    ['biceps', 1],
    ['forearms', 0],
    ['abs', 1],
    ['lats', 2],
    ['upper_back', 2],
    ['rear_delts', 1],
    ['lower_back', 3],
    ['glutes', 3],
    ['hip_flexors', 2],
    ['quads', 4],
    ['adductors', 3],
    ['hamstrings', 2],
    ['calves', 1],
    ['tibialis', 0],
  ]);

  /** The redraw, front so far; its back is the current one until drawn. */
  const REDRAWN = { front: REDRAW_FRONT, back: STATUE_ART.back };

  const params = new URLSearchParams(location.search);
  /** `?only=current|redrawn` shows one; `?width=` sets each panel's width. */
  const only = params.get('only');
  const width = Number(params.get('width') ?? 360);
  const shows = (name: string) => only === null || only === name;
</script>

<main style:--panel="{width}px">
  {#if shows('current')}
    <section data-panel="current">
      <h2>Current</h2>
      <Statue levels={LEVELS} />
    </section>
  {/if}
  {#if shows('redrawn')}
    <section data-panel="redrawn">
      <h2>Redrawn <span>front; back still the current</span></h2>
      <Statue levels={LEVELS} art={REDRAWN} />
    </section>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #0d0a08;
    color: #ece7df;
    font: 15px/1.4 var(--font-text);
  }

  main {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    padding: 24px;
  }

  section {
    width: var(--panel);
  }

  h2 {
    margin: 0 0 8px;
    font: 600 13px/1 var(--font-display);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h2 span {
    font: italic 400 13px/1 var(--font-text);
    letter-spacing: 0;
    text-transform: none;
    opacity: 0.7;
  }
</style>

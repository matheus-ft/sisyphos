<script lang="ts">
  import Statue from '../../src/ui/progress/Statue.svelte';
  import PhotoStatue from './PhotoStatue.svelte';
  import SculptedStatue from './SculptedStatue.svelte';

  /**
   * The statue workbench: the app's statue beside the alternatives under
   * study, at any size, with a week's training shaded on them. Not part of the
   * app (vite serves it in dev, the build leaves it out); `npm run statue`
   * opens it, `npm run statue:shots` photographs it.
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

  const params = new URLSearchParams(location.search);
  /** `?only=current|drawing|photo` shows one; `?width=` sets each panel's width. */
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
  {#if shows('drawing')}
    <section data-panel="drawing">
      <h2>Sculpted drawing</h2>
      <div class="field">
        <div class="pair">
          <SculptedStatue levels={LEVELS} view="front" />
          <SculptedStatue levels={LEVELS} view="back" />
        </div>
      </div>
    </section>
  {/if}
  {#if shows('photo')}
    <section data-panel="photo">
      <h2>Photograph</h2>
      <div class="field">
        <div class="single">
          <PhotoStatue levels={LEVELS} />
        </div>
        <p class="note">Front only: no free back view of this statue yet.</p>
      </div>
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
    /* The marble the app's statue panel uses (Statue.svelte), for the alternatives too. */
    --vol-0: #ece7df;
    --vol-1: #e8c7a6;
    --vol-2: #db9d6f;
    --vol-3: #c26b3d;
    --vol-4: #96401a;
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

  .field {
    padding: 16px 12px;
    border-radius: 12px;
    background: #1e140f;
  }

  .pair {
    display: flex;
    gap: 8px;
  }

  .pair > :global(svg) {
    flex: 1 1 0;
    max-width: 50%;
  }

  .single {
    width: 62%;
    margin: 0 auto;
  }

  .note {
    margin: 8px 0 0;
    font-style: italic;
    text-align: center;
    opacity: 0.7;
  }
</style>

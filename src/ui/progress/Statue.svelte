<script lang="ts">
  import type { Snippet } from 'svelte';
  import musclesCsv from '../../library/muscles.csv?raw';
  import { parseMuscles } from '../../library/parse';
  import { regionFills, type StatueView } from '../statue';
  import { STATUE_ART, type PaintedPart } from './statue-art';

  interface Props {
    /** Muscle id to volume level, 0 (untrained) to 4. */
    levels: Map<string, number>;
    selected?: string | null;
    onpick?: (muscleId: string) => void;
    view?: 'both' | 'front' | 'back';
    /** Shown inside the panel beneath the figures: the legend and its caption. */
    children?: Snippet;
  }
  let { levels, selected = null, onpick, view = 'both', children }: Props = $props();

  /** Painted over the muscles, in this order. */
  const LINES = ['wash', 'dilute', 'relief', 'contour', 'fine', 'hair', 'beads', 'fillet'] as const;

  const names = new Map(parseMuscles(musclesCsv).map((m) => [m.id, m.name]));
  const fills = $derived(regionFills(levels));
  const views = $derived<StatueView[]>(view === 'both' ? ['front', 'back'] : [view]);

  /** Keyboard focus, outlined like the selection; a tap's focus is not. */
  let focused = $state<{ view: StatueView; muscle: string } | null>(null);

  const fillOf = (v: StatueView, region: string) =>
    `var(${(fills[v] as Record<string, string>)[region]})`;

  /** With both figures shown, a group on both is one stop for the keyboard, on the front. */
  const tabStop = (v: StatueView, muscle: string) =>
    v === 'back' &&
    views.length === 2 &&
    STATUE_ART.front.some((p) => p.muscles.some((m) => m.muscle === muscle))
      ? -1
      : 0;

  /** Outlines go on with their part, so whatever is painted over the muscle covers them too. */
  const outlines = (part: PaintedPart, v: StatueView) =>
    part.muscles.flatMap((m) => [
      ...(m.muscle === selected ? [{ m, kind: 'selected' }] : []),
      ...(focused?.view === v && m.muscle === focused.muscle ? [{ m, kind: 'focus' }] : []),
    ]);

  function onkeydown(event: KeyboardEvent, muscle: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onpick?.(muscle);
  }
</script>

<div class="statue">
  <span class="meander" aria-hidden="true"></span>
  <div class="figures">
    {#each views as v (v)}
      <figure>
        <svg viewBox="0 0 120 300">
          {#each STATUE_ART[v] as part, i (i)}
            {#each part.fill as d, k (k)}<path class="fill" {d} />{/each}
            {#each part.muscles as m (m.muscle)}
              <g
                class="muscle"
                role="button"
                tabindex={tabStop(v, m.muscle)}
                aria-label={names.get(m.muscle) ?? m.muscle}
                aria-pressed={selected === m.muscle}
                onclick={() => onpick?.(m.muscle)}
                onkeydown={(e) => onkeydown(e, m.muscle)}
                onfocus={(e) => {
                  if (e.currentTarget.matches(':focus-visible'))
                    focused = { view: v, muscle: m.muscle };
                }}
                onblur={() => (focused = null)}
              >
                {#each m.regions as r (r.region)}
                  <path class="region" d={r.d} style:fill={fillOf(v, r.region)} />
                {/each}
              </g>
            {/each}
            {#each LINES as layer (layer)}
              {#each part[layer] as d, k (k)}<path class={layer} {d} />{/each}
            {/each}
            {#each outlines(part, v) as { m, kind } (kind)}
              {#each m.regions as r (r.region)}
                <path class="casing" d={r.d} />
                <path class={kind} d={r.d} />
              {/each}
            {/each}
          {/each}
        </svg>
        <figcaption class="caps">{v === 'front' ? 'Front' : 'Back'}</figcaption>
      </figure>
    {/each}
  </div>
  {@render children?.()}
  <span class="meander" aria-hidden="true"></span>
</div>

<style>
  /* Always a clay figure on the black glaze, in both modes: a red-figure
     painting, whatever the page around it. */
  .statue {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--statue-field);
    box-shadow: var(--shadow-2);
    color: var(--vol-0);
  }

  .meander {
    opacity: 0.9;
  }

  .figures {
    display: flex;
    justify-content: center;
    gap: var(--space-2);
  }

  figure {
    flex: 1 1 0;
    max-width: 160px;
    margin: 0;
    text-align: center;
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }

  figcaption {
    margin-top: var(--space-1);
  }

  path {
    pointer-events: none;
  }

  .fill {
    fill: var(--vol-0);
  }

  .muscle {
    cursor: pointer;
    outline: none;
  }

  .region {
    pointer-events: visiblePainted;
    stroke: var(--statue-dilute);
    stroke-opacity: 0.8;
    stroke-width: 0.55;
    stroke-linejoin: round;
    transition: fill var(--dur-base) var(--ease-out);
  }

  /* Dilute glaze: a golden-brown wash for shade, thin lines for minor anatomy. */
  .wash {
    fill: var(--statue-dilute);
    opacity: 0.28;
  }

  .dilute,
  .relief,
  .contour,
  .fine,
  .beads,
  .fillet,
  .casing,
  .selected,
  .focus {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .dilute {
    stroke: var(--statue-dilute);
    stroke-width: 0.9;
  }

  /* The relief line: black glaze laid thick, standing up from the clay. */
  .relief {
    stroke: var(--statue-line);
    stroke-width: 1.2;
  }

  .contour {
    stroke: var(--statue-line);
    stroke-width: 1.7;
  }

  .fine {
    stroke: var(--statue-line);
    stroke-width: 0.8;
  }

  .hair {
    fill: var(--statue-line);
  }

  .beads {
    stroke: var(--vol-0);
    stroke-opacity: 0.55;
    stroke-width: 0.6;
  }

  .fillet {
    stroke: var(--vol-0);
    stroke-width: 0.9;
  }

  .casing {
    stroke: var(--statue-line);
    stroke-width: 2.8;
  }

  .selected {
    stroke: var(--vol-0);
    stroke-width: 1.2;
  }

  .focus {
    stroke: var(--vol-0);
    stroke-width: 1.2;
    stroke-dasharray: 2.4 1.6;
  }

  @media (prefers-reduced-motion: reduce) {
    .region {
      transition: none;
    }
  }
</style>

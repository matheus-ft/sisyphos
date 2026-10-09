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
  const LINES = ['wash', 'dilute', 'relief', 'contour', 'fine', 'hair', 'locks'] as const;

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
        <svg viewBox="0 0 120 302">
          <defs>
            <!-- The modelling that makes the drawing read as carved: each shape, and
                 then the whole figure, rounded under a light from the upper left. The
                 height map is the shape's own edge, blurred; flat ground keeps its
                 colour (the diffuse constant undoes the light's elevation), so the
                 volume shades still match the legend. -->
            <filter id="round-{v}" color-interpolation-filters="sRGB">
              <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" result="height" />
              <feDiffuseLighting
                in="height"
                surfaceScale="1.1"
                diffuseConstant="1.45"
                lighting-color="#fff"
                result="light"
              >
                <feDistantLight azimuth="235" elevation="44" />
              </feDiffuseLighting>
              <feComposite in="light" in2="SourceAlpha" operator="in" result="lit" />
              <feBlend in="SourceGraphic" in2="lit" mode="multiply" />
            </filter>
            <filter
              id="carve-{v}"
              x="-10%"
              y="-4%"
              width="120%"
              height="108%"
              color-interpolation-filters="sRGB"
            >
              <feGaussianBlur in="SourceAlpha" stdDeviation="3.2" result="height" />
              <feDiffuseLighting
                in="height"
                surfaceScale="4"
                diffuseConstant="1.45"
                lighting-color="#fff"
                result="light"
              >
                <feDistantLight azimuth="235" elevation="44" />
              </feDiffuseLighting>
              <feComposite in="light" in2="SourceAlpha" operator="in" result="lit" />
              <feBlend in="SourceGraphic" in2="lit" mode="multiply" result="shaded" />
              <feSpecularLighting
                in="height"
                surfaceScale="4"
                specularConstant="0.22"
                specularExponent="10"
                lighting-color="#fff"
                result="shine"
              >
                <feDistantLight azimuth="235" elevation="44" />
              </feSpecularLighting>
              <feComposite in="shine" in2="SourceAlpha" operator="in" result="gloss" />
              <feComposite in="shaded" in2="gloss" operator="arithmetic" k2="1" k3="0.5" />
            </filter>
          </defs>
          <g filter="url(#carve-{v})">
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
                    <path
                      class="region"
                      d={r.d}
                      style:fill={fillOf(v, r.region)}
                      filter="url(#round-{v})"
                    />
                  {/each}
                </g>
              {/each}
              {#each LINES as layer (layer)}
                {#each part[layer] as d, k (k)}<path
                    class={layer}
                    {d}
                    filter={layer === 'hair' ? `url(#round-${v})` : undefined}
                  />{/each}
              {/each}
              {#each outlines(part, v) as { m, kind } (kind)}
                {#each m.regions as r (r.region)}
                  <path class="casing" d={r.d} />
                  <path class={kind} d={r.d} />
                {/each}
              {/each}
            {/each}
          </g>
        </svg>
        <figcaption class="caps">{v === 'front' ? 'Front' : 'Back'}</figcaption>
      </figure>
    {/each}
  </div>
  {@render children?.()}
  <span class="meander" aria-hidden="true"></span>
</div>

<style>
  /* Always a marble statue, lit on the black glaze, in both modes, whatever
     the page around it. Untrained is the bare marble, and work stains it
     toward terracotta; the legend inside the panel reads the same shades. */
  .statue {
    --vol-0: #ece7df;
    --vol-1: #e8c7a6;
    --vol-2: #db9d6f;
    --vol-3: #c26b3d;
    --vol-4: #96401a;
    --statue-line: #4a443e;
    --statue-dilute: #a49b90;
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
    filter: url(#round-front);
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
  .locks,
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

  /* Carved edges, not painted ones: the lines are the shadow in a cut. */
  .relief {
    stroke: var(--statue-line);
    stroke-opacity: 0.7;
    stroke-width: 0.9;
  }

  .contour {
    stroke: var(--statue-line);
    stroke-opacity: 0.85;
    stroke-width: 1.1;
  }

  .fine {
    stroke: var(--statue-line);
    stroke-opacity: 0.8;
    stroke-width: 0.7;
  }

  /* Hair and beard in the same marble, a shade deeper, their curls cut into it. */
  .hair {
    fill: color-mix(in srgb, var(--vol-0) 78%, var(--statue-line));
  }

  .locks {
    stroke: var(--statue-line);
    stroke-opacity: 0.55;
    stroke-width: 0.6;
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

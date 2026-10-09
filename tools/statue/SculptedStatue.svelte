<script lang="ts">
  import { STATUE_ART } from '../../src/ui/progress/statue-art';
  import { regionFills, type StatueView } from '../../src/ui/statue';

  /**
   * The drawn statue rendered as a drawing of a sculpture rather than a flat
   * figure: the same shapes as the app's (`statue-art.ts`), so every muscle
   * still maps, but each one shaded round under a light from the upper left,
   * grooves as soft shadow instead of ink lines, and marble veining over all.
   */
  interface Props {
    levels: Map<string, number>;
    view: StatueView;
  }
  let { levels, view }: Props = $props();

  const fills = $derived(regionFills(levels));
  const fillOf = (region: string) => `var(${(fills[view] as Record<string, string>)[region]})`;
  const art = $derived(STATUE_ART[view]);
  const id = (name: string) => `${name}-${view}`;
</script>

<svg viewBox="0 0 120 302" class="sculpted">
  <defs>
    <!-- Each shape's volume: lit high on the upper left, falling into shadow low on the right. -->
    <radialGradient id={id('volume')} cx="0.36" cy="0.3" r="0.85">
      <stop offset="0" stop-color="#fff" stop-opacity="0.5" />
      <stop offset="0.45" stop-color="#fff" stop-opacity="0" />
      <stop offset="0.8" stop-color="#000" stop-opacity="0.16" />
      <stop offset="1" stop-color="#000" stop-opacity="0.34" />
    </radialGradient>
    <!-- Grooves: the shadow in a cut, soft rather than inked. -->
    <filter id={id('groove')} x="-5%" y="-5%" width="110%" height="110%">
      <feGaussianBlur stdDeviation="0.7" />
    </filter>
    <!-- Marble: faint grey veins over the stone, inside the figure only. -->
    <filter
      id={id('marble')}
      x="0"
      y="0"
      width="100%"
      height="100%"
      color-interpolation-filters="sRGB"
    >
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.03 0.11"
        numOctaves="3"
        seed="7"
        result="noise"
      />
      <feColorMatrix
        in="noise"
        type="matrix"
        values="0 0 0 0 0.45  0 0 0 0 0.43  0 0 0 0 0.41  0 0 0 -4 1.32"
        result="veins"
      />
      <feComposite in="veins" in2="SourceAlpha" operator="in" result="inside" />
      <feMerge>
        <feMergeNode in="SourceGraphic" />
        <feMergeNode in="inside" />
      </feMerge>
    </filter>
    <!-- The figure as a whole, rounded at its edges under the same light. -->
    <filter
      id={id('carve')}
      x="-10%"
      y="-4%"
      width="120%"
      height="108%"
      color-interpolation-filters="sRGB"
    >
      <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="height" />
      <feDiffuseLighting
        in="height"
        surfaceScale="3.5"
        diffuseConstant="1.42"
        lighting-color="#fff"
        result="light"
      >
        <feDistantLight azimuth="235" elevation="45" />
      </feDiffuseLighting>
      <feComposite in="light" in2="SourceAlpha" operator="in" result="lit" />
      <feBlend in="SourceGraphic" in2="lit" mode="multiply" />
    </filter>
  </defs>

  <g filter="url(#{id('carve')})">
    <g filter="url(#{id('marble')})">
      {#each art as part, i (i)}
        {#each part.fill as d, k (k)}<path class="stone" {d} />{/each}
        {#each part.muscles as m (m.muscle)}
          {#each m.regions as r (r.region)}
            <path d={r.d} style:fill={fillOf(r.region)} />
            <path d={r.d} fill="url(#{id('volume')})" />
          {/each}
        {/each}
        {#each part.wash as d, k (k)}<path class="shade" {d} />{/each}
        {#each part.hair as d, k (k)}<path class="hair" {d} />{/each}
      {/each}
    </g>
    {#each art as part, i (i)}
      {#each part.muscles as m (m.muscle)}
        {#each m.regions as r (r.region)}<path
            class="groove"
            d={r.d}
            filter="url(#{id('groove')})"
          />{/each}
      {/each}
      {#each [...part.dilute, ...part.relief] as d, k (k)}<path
          class="groove"
          {d}
          filter="url(#{id('groove')})"
        />{/each}
      {#each part.contour as d, k (k)}<path class="edge" {d} />{/each}
      {#each part.fine as d, k (k)}<path class="fine" {d} />{/each}
      {#each part.locks as d, k (k)}<path class="locks" {d} />{/each}
    {/each}
  </g>
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }

  .stone {
    fill: var(--vol-0);
  }

  .shade {
    fill: #000;
    opacity: 0.12;
  }

  .hair {
    fill: color-mix(in srgb, var(--vol-0) 70%, #3a342e);
  }

  .groove,
  .edge,
  .fine,
  .locks {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .groove {
    stroke: #2e2924;
    stroke-opacity: 0.32;
    stroke-width: 1.1;
  }

  .edge {
    stroke: #1e1a16;
    stroke-opacity: 0.6;
    stroke-width: 1.1;
  }

  .fine {
    stroke: #3a342e;
    stroke-opacity: 0.7;
    stroke-width: 0.6;
  }

  .locks {
    stroke: #3a342e;
    stroke-opacity: 0.5;
    stroke-width: 0.6;
  }
</style>

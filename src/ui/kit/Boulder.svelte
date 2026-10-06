<script lang="ts">
  import { untrack } from 'svelte';
  import { Tween } from 'svelte/motion';
  import {
    BOULDER_RADIUS,
    HILL_PATH,
    PUSHER_HEAD,
    PUSHER_PATH,
    RIDGE_LINE,
    STANDING_HEAD,
    STANDING_PATH,
    STONE_INCISIONS,
    STONE_PATH,
    SUMMIT_PATH,
    gloryStrokes,
    poseAt,
  } from '../hill';
  import { durationOf, easeRoll } from './motion';

  /**
   * The hill and the boulder: a session's progress as the stone Sisyphos
   * pushes up, one notch per set. One drawing at four sizes:
   *
   * - `header`: the session header's relief, up to 200 wide;
   * - `frieze`: the same, the full width of the Train screen;
   * - `empty`: the same at 132 wide, over an empty state;
   * - `hero`: the finish screen's scene, edge to edge, the stone at the summit.
   *
   * A change of `progress` rolls the stone there over --dur-roll. When
   * `arrived` turns true (or a hero mounts) the stone rolls the rest of the
   * way, Sisyphos stands, the stone settles and five strokes of glory draw in.
   * Under prefers-reduced-motion it shows the final state at once.
   */
  interface Props {
    /** 0 to 1, as `boulderProgress` in finish.ts measures it. */
    progress?: number;
    /** At the top: standing pose, settle, glory. A hero is always arrived. */
    arrived?: boolean;
    size?: 'header' | 'frieze' | 'empty' | 'hero';
    /**
     * The accessible name; by default "Boulder N percent of the way up the
     * hill". Null makes the drawing decoration, for when words beside it say
     * the same.
     */
    label?: string | null;
  }
  let { progress = 0, arrived = false, size = 'header', label }: Props = $props();

  const hero = $derived(size === 'hero');
  const target = $derived(arrived || hero ? 1 : Math.min(Math.max(progress, 0), 1));
  const tween = new Tween(
    untrack(() => target),
    { easing: easeRoll },
  );
  $effect(() => {
    void tween.set(target, { duration: durationOf('--dur-roll') });
  });

  const pose = $derived(poseAt(tween.current));
  /** Standing once the stone is at the top: the pushing pose would push it over. */
  const standing = $derived((arrived || hero) && tween.current >= 0.999);
  const name = $derived(
    label === undefined
      ? `Boulder ${Math.round(target * 100)} percent of the way up the hill`
      : label,
  );
  const glory = gloryStrokes();
  const r = BOULDER_RADIUS;
  /**
   * The strata are the ridge moved down, so at the foot they run below the
   * hill; the drawing overflows its box for the glory strokes, so they are
   * clipped to the hill instead.
   */
  const uid = $props.id();
  const clip = `hill-${uid}`;
</script>

{#snippet stone(scale: number)}
  <g transform="scale({scale})">
    <path class="boulder" d={STONE_PATH} />
    {#each STONE_INCISIONS as d (d)}<path class="boulder-inc" {d} />{/each}
  </g>
{/snippet}

{#if hero}
  <svg
    class="scene"
    viewBox="0 0 375 236"
    role={name ? 'img' : undefined}
    aria-label={name ?? undefined}
    aria-hidden={name ? undefined : 'true'}
  >
    <path
      class="hill-fill"
      d="M0,236 V196 C44,190 96,166 146,134 C190,106 214,80 240,74 L304,74 C330,88 346,124 375,144 V236 Z"
    />
    <path
      class="hill-inc"
      d="M0,206 C46,200 100,176 152,143 C196,115 220,90 244,84 L302,84 C324,96 340,130 375,152"
    />
    <path
      class="hill-inc dash"
      d="M0,216 C48,210 104,187 158,153 C200,126 224,100 248,94 L300,94 C320,106 336,138 375,160"
    />
    <path
      class="hill-inc dot"
      d="M0,226 C50,220 108,198 164,163 C206,137 228,110 252,104 L298,104 C316,116 330,146 375,168"
    />
    <path
      class="pusher"
      style:stroke-width="3.6"
      d="M236,38 L236,57 M236,44 L228,57 M236,44 L252,49 M236,57 L231,73 M236,57 L242,73"
    />
    <circle class="pusher-head" cx="236" cy="31" r="5.2" />
    <g class="arrive settle">
      <g transform="translate(277 50)">{@render stone(24)}</g>
    </g>
    {#each ['M258,18 L254,10', 'M277,14 L277,5', 'M296,18 L300,10', 'M312,30 L320,25', 'M242,30 L234,25'] as d, i (d)}
      <path class="glory draw" style:--i={i} pathLength="1" {d} />
    {/each}
  </svg>
{:else}
  <svg
    class="hill {size}"
    viewBox="0 0 200 72"
    role={name ? 'img' : undefined}
    aria-label={name ?? undefined}
    aria-hidden={name ? undefined : 'true'}
  >
    <defs><clipPath id={clip}><path d={HILL_PATH} /></clipPath></defs>
    <path class="hill-fill" d={HILL_PATH} />
    <g clip-path="url(#{clip})">
      <path class="hill-inc" d={RIDGE_LINE} transform="translate(0 7)" />
      <path class="hill-inc dash" d={RIDGE_LINE} transform="translate(0 14)" />
      <path class="hill-inc dot" d={RIDGE_LINE} transform="translate(0 21)" />
    </g>
    {#if !standing}<path class="summit" d={SUMMIT_PATH} />{/if}
    <g transform="translate({pose.x} {pose.y}) rotate({standing ? 0 : pose.angle})">
      {#if standing}
        <path class="pusher" d={STANDING_PATH} />
        <circle class="pusher-head" {...STANDING_HEAD} />
      {:else}
        <path class="pusher" d={PUSHER_PATH} />
        <circle class="pusher-head" {...PUSHER_HEAD} />
      {/if}
      <g class="arrive" class:settle={standing}>
        <g transform="rotate({pose.roll})">{@render stone(r)}</g>
      </g>
      {#if standing}
        {#each glory as d, i (d)}<path class="glory draw" style:--i={i} pathLength="1" {d} />{/each}
      {/if}
    </g>
  </svg>
{/if}

<style>
  svg {
    display: block;
    height: auto;
    overflow: visible;
  }

  .header {
    width: 100%;
    max-width: 200px;
  }

  .frieze,
  .scene {
    width: 100%;
  }

  .empty {
    width: 132px;
  }

  .hill-fill {
    fill: var(--figure);
  }

  /* Lines incised through the glaze, down to the ground beneath. */
  .hill-inc {
    fill: none;
    stroke: var(--ground);
    stroke-width: 1;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .dash {
    stroke-dasharray: 5 4;
  }

  .dot {
    stroke-dasharray: 1.5 4;
  }

  .boulder {
    fill: var(--figure);
    stroke: var(--figure);
    stroke-width: 0.06;
    stroke-linejoin: round;
  }

  .boulder-inc {
    fill: none;
    stroke: var(--ground);
    stroke-width: 1.1;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .pusher {
    fill: none;
    stroke: var(--figure);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .pusher-head {
    fill: var(--figure);
  }

  .summit {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .glory {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.6;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .arrive {
    transform-box: fill-box;
    transform-origin: 50% 100%;
  }

  /* The stone overshoots the summit a little and comes to rest. */
  .settle {
    animation: settle var(--dur-settle) var(--ease-settle) both;
  }

  /* Then the strokes of glory draw in, 60ms apart, once it has settled. */
  .draw {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw var(--dur-base) var(--ease-out) forwards;
    animation-delay: calc(var(--dur-settle) + var(--i) * 60ms);
  }

  @keyframes settle {
    0% {
      transform: translateY(-7px) rotate(-7deg);
    }
    55% {
      transform: translateY(1.5px) rotate(1.5deg);
    }
    100% {
      transform: none;
    }
  }

  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .settle {
      animation: none;
    }

    .draw {
      animation: none;
      stroke-dashoffset: 0;
    }
  }
</style>

<script lang="ts">
  /**
   * The Greek-key band: the tile of --meander-key (an exact 8 × 7 grid, line
   * and ground one unit each) repeated as a mask, so it takes any colour. One
   * per screen at most: under the session header, or framing the finish
   * scene, the statue panel or the share card.
   *
   * With `progress`, the band is two colours split at that fraction: the rest
   * takeover's elapsed time in `color`, the remainder in `track`.
   */
  interface Props {
    /** One grid unit in px, kept whole-pixel-friendly: 1.5 in headers, 2 on the takeover. */
    unit?: number;
    /** Between two hairline rules, as on a pot's shoulder. */
    framed?: boolean;
    /** Any CSS colour; the default is the colour of the surrounding text. */
    color?: string;
    /** 0 to 1: how much of the band is `color`; the rest is `track`. */
    progress?: number;
    track?: string;
  }
  let { unit = 1.5, framed = false, color, progress, track = 'var(--line)' }: Props = $props();

  const fill = $derived.by(() => {
    if (progress === undefined) return undefined;
    const pct = Math.round(Math.min(Math.max(progress, 0), 1) * 1000) / 10;
    return `linear-gradient(90deg, currentColor ${pct}%, ${track} ${pct}%)`;
  });
</script>

<span
  class={framed ? 'meander-framed' : 'meander'}
  class:split={fill !== undefined}
  style:--meander-unit="{unit}px"
  style:--meander-fill={fill}
  style:color
  aria-hidden="true"
></span>

<style>
  .split {
    background: var(--meander-fill);
  }

  .meander-framed.split::before {
    background: var(--meander-fill);
  }
</style>

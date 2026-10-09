<script lang="ts">
  import { volumeToken } from '../../src/ui/statue';
  import photo from './photo/farnese-front.png';
  import { FRONT_REGIONS, PHOTO_SIZE, polygonPath } from './photo/regions';

  /**
   * A photograph of a real statue as the body, its muscle groups tinted over
   * the marble by volume (`photo/regions.ts`). Front only: see photo/CREDITS.md.
   * Untrained is the bare stone; the tint deepens with the level, laid on with
   * multiply so the stone's own light and shade show through it.
   */
  interface Props {
    levels: Map<string, number>;
  }
  let { levels }: Props = $props();

  const tinted = $derived(
    Object.entries(FRONT_REGIONS).flatMap(([muscle, polys]) => {
      const level = levels.get(muscle) ?? 0;
      return level <= 0
        ? []
        : polys.map((poly) => ({ d: polygonPath(poly), color: `var(${volumeToken(level)})` }));
    }),
  );
</script>

<!-- Cropped above the museum's own pedestal: the statue's plinth is its own. -->
<svg viewBox="0 0 {PHOTO_SIZE.width} {PHOTO_SIZE.crop}">
  <defs>
    <filter id="photo-soft" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="6" />
    </filter>
    <mask id="photo-stone" style="mask-type: alpha">
      <image href={photo} width={PHOTO_SIZE.width} height={PHOTO_SIZE.height} />
    </mask>
  </defs>
  <image
    href={photo}
    width={PHOTO_SIZE.width}
    height={PHOTO_SIZE.height}
    style="filter: grayscale(0.85) brightness(1.08) contrast(1.05)"
  />
  <g mask="url(#photo-stone)" style="mix-blend-mode: multiply">
    {#each tinted as t, i (i)}
      <path d={t.d} fill={t.color} filter="url(#photo-soft)" opacity="0.85" />
    {/each}
  </g>
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
</style>

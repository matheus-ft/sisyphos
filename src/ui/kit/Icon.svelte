<script lang="ts" module>
  /**
   * The glyph set: a 24 grid, 2px square strokes and mitred joins, whose
   * angles echo the meander. Drawn in currentColor, so a glyph takes the colour
   * of the text it sits in.
   */
  const GLYPHS = {
    back: 'M15 4 7 12l8 8',
    chev: 'M9 5l7 7-7 7',
    down: 'M5 9l7 7 7-7',
    plus: 'M12 4v16M4 12h16',
    minus: 'M4 12h16',
    check: 'M4 12.5l5 5L20 6',
    close: 'M5 5l14 14M19 5L5 19',
    bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
    bellOff: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4M3 3l18 18',
    share: 'M12 3v12M7 8l5-5 5 5M5 13v8h14v-8',
    download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
    conflict: 'M7 4v12M3 12l4 4 4-4M17 20V8M13 12l4-4 4 4',
    sheet: 'M4 14h16v6H4zM8 10l4-4 4 4',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
    up: 'M12 19V5M6 11l6-6 6 6',
    same: 'M5 9h14M5 15h14',
    warn: 'M12 3l10 18H2zM12 10v5M12 18v.5',
    edit: 'M4 20l4-1 11-11-3-3L5 16z',
    cloud: 'M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z',
  } as const;

  export type IconName = keyof typeof GLYPHS | 'more' | 'sun' | 'search' | 'info';
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    /** 'sm' is 16px, as in chips and chevrons; the default is 22px. A number sets the px. */
    size?: 'sm' | 'md' | number;
    /** Names the glyph for a screen reader; without it the glyph is decoration. */
    label?: string;
    /** Heavier strokes for small glyphs that must still read (the seal's check is 2.4). */
    stroke?: number;
  }
  let { name, size = 'md', label, stroke }: Props = $props();

  const px = $derived(typeof size === 'number' ? `${size}px` : undefined);
</script>

<svg
  class="ico"
  class:ico-sm={size === 'sm'}
  viewBox="0 0 24 24"
  style:width={px}
  style:height={px}
  style:stroke-width={stroke}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  {#if name === 'more'}
    <path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.4" stroke-linecap="round" />
  {:else if name === 'sun'}
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="6" />
    <path d="M16 16l5 5" />
  {:else if name === 'info'}
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7v.5" />
  {:else}
    <path d={GLYPHS[name]} />
  {/if}
</svg>

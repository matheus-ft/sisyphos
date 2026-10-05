<script lang="ts">
  /**
   * The rest takeover: after a working set is saved, the screen turns into the
   * rest, on the black glaze in both modes. A giant countdown to the target
   * rest; at zero it turns terracotta, breathes and counts up. −15 s / +15 s
   * change the exercise's target rest (the owner remembers it); Skip rest ends
   * the rest; the close button keeps it running behind the header's readout.
   * Every number is read from `startedAt` and the wall clock, so a locked or
   * suspended phone shows the right time on return.
   */
  import { onMount } from 'svelte';
  import { restBell } from '../device';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import Meander from '../kit/Meander.svelte';
  import { overlays } from '../overlays.svelte';
  import { bellStep, figureParts, restFace, type BellState } from '../restview';

  interface Props {
    /** When the rest began (the set was saved), in epoch ms. */
    startedAt: number;
    /** The exercise's target rest in seconds; null counts up, as in v0, without the band. */
    targetS: number | null;
    /** "Bench press · set 2 of 4 done". */
    context: string;
    /**
     * The set that comes next, or null when none is left. `exerciseFirst` puts
     * the exercise's name above the figures (the next set is another exercise)
     * and `rest` is that exercise's own target rest, shown beside its name.
     */
    next: {
      label: string;
      figures: string;
      exercise: string;
      exerciseFirst?: boolean;
      rest?: string | null;
    } | null;
    /** Play a chime at zero, while the app is open. */
    chime: boolean;
    /** Keep the screen awake (Wake Lock). */
    awake: boolean;
    /** −15 or +15: changes the exercise's target rest. */
    onadjust: (deltaS: number) => void;
    /** Ends the rest now. */
    onskip: () => void;
    /** Back to the log; the rest keeps running. */
    onclose: () => void;
    /** "Log set 3": closes the takeover and opens the entry panel on the next set. */
    onlognext?: () => void;
    onchime: (on: boolean) => void;
    onawake: (on: boolean) => void;
  }
  let {
    startedAt,
    targetS,
    context,
    next,
    chime,
    awake,
    onadjust,
    onskip,
    onclose,
    onlognext,
    onchime,
    onawake,
  }: Props = $props();

  let now = $state(Date.now());
  let bell: BellState = { rung: false };
  let root: HTMLElement | undefined = $state();

  const face = $derived(restFace(startedAt, targetS, now));

  function tick(): void {
    now = Date.now();
    if (targetS === null) return;
    const overtimeMs = now - (startedAt + targetS * 1000);
    const step = bellStep(
      bell,
      restFace(startedAt, targetS, now),
      overtimeMs,
      document.visibilityState === 'visible',
      chime,
    );
    bell = step.state;
    if (step.ring) restBell().play();
  }

  onMount(() => {
    tick();
    const timer = setInterval(tick, 250);
    // iOS suspends a backgrounded app: timers stop, and the first thing back is one of these.
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('pageshow', tick);
    root?.focus();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('pageshow', tick);
    };
  });

  function toggleChime(): void {
    // iOS lets a page make sound only once a tap has asked for it.
    if (!chime) restBell().prime();
    onchime(!chime);
  }

  /** Keeps Tab inside the takeover, which covers the screen it sits over. */
  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onclose();
      return;
    }
    if (event.key !== 'Tab' || !root) return;
    const stops = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')];
    if (stops.length === 0) return;
    const [first, last] = [stops[0], stops[stops.length - 1]];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<div
  class="rest"
  class:over={face.over}
  class:toasting={overlays.toast !== null}
  role="dialog"
  aria-modal="true"
  aria-label="Rest"
  tabindex="-1"
  bind:this={root}
  onkeydown={keydown}
>
  <div class="pulse" aria-hidden="true"></div>

  <div class="top">
    <span class="label" aria-live="polite">{face.label}</span>
    <span class="tools">
      <button class="icon-btn" aria-pressed={chime} aria-label="Chime at zero" onclick={toggleChime}
        ><Icon name={chime ? 'bell' : 'bellOff'} /></button
      >
      <button
        class="icon-btn"
        aria-pressed={awake}
        aria-label="Keep screen on"
        onclick={() => onawake(!awake)}><Icon name="sun" /></button
      >
      <button class="icon-btn" aria-label="Back to the log" onclick={onclose}
        ><Icon name="close" /></button
      >
    </span>
  </div>

  <p class="context">{context}</p>

  <p class="time figure-num" class:long={face.long} role="timer" aria-label={face.spoken}>
    {#if face.plus}<span class="plus" aria-hidden="true">+</span>{/if}<span aria-hidden="true"
      >{face.clock}</span
    >
  </p>
  <p class="of">{face.of ?? ''}</p>

  {#if face.fraction !== null}
    <div class="band">
      <Meander
        unit={2}
        color="var(--rest-ink)"
        track="var(--rest-track)"
        progress={face.over ? 1 : face.fraction}
      />
    </div>
  {/if}

  <div class="adjust">
    <button class="figure-num" onclick={() => onadjust(-15)}>−15 s</button>
    <button class="figure-num" onclick={() => onadjust(15)}>+15 s</button>
    <button class="caps" onclick={onskip}>Skip rest</button>
  </div>

  {#if next}
    <div class="next">
      <p class="caps">Next</p>
      {#if next.exerciseFirst}
        <p class="meta lead">
          {next.exercise}{#if next.rest}<span> · rest {next.rest}</span>{/if}
        </p>
      {/if}
      <p>
        <span class="meta next-label">{next.label}</span>
        <b class="figure-num"
          >{#each figureParts(next.figures) as part, i (i)}<span class:dim={part.muted}
              >{part.text}</span
            >{/each}</b
        >
      </p>
      {#if !next.exerciseFirst}<p class="meta">{next.exercise}</p>{/if}
    </div>
    {#if onlognext}
      <Button variant="primary" bench full onclick={onlognext}
        >Log {next.label.toLowerCase()}</Button
      >
    {/if}
  {/if}
</div>

<style>
  .rest {
    position: fixed;
    inset: 0;
    z-index: var(--z-takeover);
    display: flex;
    flex-direction: column;
    padding: var(--safe-top) var(--gutter) calc(var(--space-5) + var(--safe-bottom));
    overflow: hidden;
    background: var(--rest-field);
    color: var(--rest-ink);
    outline: none;
    transition:
      background-color var(--dur-base) var(--ease-in-out),
      padding-bottom var(--dur-fast) var(--ease-out);
    animation: arrive var(--dur-enter) var(--ease-out) both;
  }

  /* The undo toast sits at the foot over the takeover for its 5 s: the next set and its Log lift clear of it. */
  .toasting {
    padding-bottom: calc(var(--safe-bottom) + 76px);
  }

  .over {
    background: var(--rest-over);
    color: var(--rest-over-ink);
  }

  /*
   * Breathes in opacity only, so the text above it is never repainted. Under
   * everything the takeover holds: the Log button is another component's, which
   * this one's scoped styles cannot lift above it.
   */
  .pulse {
    position: absolute;
    inset: 0;
    z-index: -1;
    background: var(--rest-over-2);
    opacity: 0;
    pointer-events: none;
  }

  .over .pulse {
    animation: breathe var(--dur-pulse) var(--ease-in-out) infinite;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
  }

  .label {
    font: var(--fw-display) 0.875rem / 1 var(--font-display);
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--rest-accent);
  }

  .over .label,
  .over .context,
  .over .of {
    color: var(--rest-over-ink);
  }

  .tools {
    display: flex;
  }

  .tools .icon-btn {
    color: var(--rest-muted);
    border-radius: var(--radius-pill);
  }

  .over .tools .icon-btn {
    color: var(--rest-over-ink);
  }

  .tools .icon-btn[aria-pressed='true'] {
    background: var(--rest-surface);
    color: var(--rest-ink);
  }

  .over .tools .icon-btn[aria-pressed='true'] {
    background: rgb(0 0 0 / 0.2);
    color: var(--rest-over-ink);
  }

  .context {
    margin: 0;
    font-style: italic;
    font-size: 1.0625rem;
    text-align: center;
    color: var(--rest-muted);
  }

  .time {
    margin: var(--space-8) 0 0;
    font-size: var(--fs-rest);
    line-height: 1;
    letter-spacing: -0.01em;
    text-align: center;
    white-space: nowrap;
  }

  /* "10:00" is wider than the screen at full size: one size down. */
  .time.long {
    font-size: clamp(6rem, 30vw, 8rem);
  }

  .plus {
    font-size: 0.5em;
    vertical-align: 0.35em;
    margin-right: 0.04em;
  }

  .of {
    min-height: 1.5rem;
    margin: var(--space-2) 0 0;
    font: italic 1.25rem / 1.2 var(--font-text);
    text-align: center;
    color: var(--rest-muted);
  }

  .band {
    margin-top: var(--space-6);
    color: var(--rest-ink);
  }

  .over .band {
    color: var(--rest-over-ink);
  }

  .adjust {
    display: grid;
    grid-template-columns: 1fr 1fr 1.25fr;
    gap: var(--space-2);
    margin-top: var(--space-6);
  }

  .adjust button {
    min-height: var(--tap-bench);
    border: var(--stroke) solid var(--rest-track);
    border-radius: var(--radius-md);
    font-size: 1.25rem;
    color: inherit;
  }

  .over .adjust button {
    border-color: rgb(253 235 211 / 0.45);
  }

  .adjust .caps {
    font-size: var(--fs-label);
  }

  .next {
    margin-top: auto;
    margin-bottom: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--rest-surface);
  }

  .over .next {
    background: rgb(0 0 0 / 0.2);
  }

  .next p {
    margin: 0;
  }

  .next .caps {
    color: var(--rest-accent);
  }

  .over .next .caps {
    color: var(--rest-over-ink);
  }

  .next .meta {
    color: var(--rest-muted);
  }

  .over .next .meta {
    color: var(--rest-over-ink);
  }

  .next .lead {
    font-size: 1.0625rem;
    font-style: normal;
    color: var(--rest-ink);
  }

  .over .next .lead {
    color: var(--rest-over-ink);
  }

  .next b {
    font-size: 1.875rem;
  }

  .next-label {
    margin-right: var(--space-2);
  }

  .dim {
    color: var(--rest-muted);
    font-weight: var(--fw-text);
  }

  .over .dim {
    color: var(--rest-over-ink);
    opacity: 0.75;
  }

  .rest :global(.button-primary) {
    background: var(--rest-ink);
    color: var(--rest-field);
    box-shadow:
      0 0 0 2px var(--rest-field),
      0 0 0 3.5px var(--rest-ink);
  }

  .over :global(.button-primary) {
    background: var(--rest-over-ink);
    color: var(--rest-over);
    box-shadow:
      0 0 0 2px var(--rest-over),
      0 0 0 3.5px var(--rest-over-ink);
  }

  @keyframes arrive {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes breathe {
    0%,
    100% {
      opacity: 0;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rest {
      animation: fade var(--dur-enter) linear both;
    }

    /* The colour says it; nothing moves. */
    .over .pulse {
      animation: none;
    }
  }
</style>

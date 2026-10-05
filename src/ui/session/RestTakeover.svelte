<script lang="ts">
  /**
   * CONTRACT STUB, filled by wave 1 (rest/finish/share package). The props
   * below are the final interface; the body is a minimal working placeholder.
   *
   * The rest takeover: after a working set is saved, the screen turns into
   * the rest, on the black glaze in both modes. A giant countdown to the
   * target rest, counting from `startedAt`; at zero it turns terracotta,
   * breathes and counts up. −15 s / +15 s change the exercise's target rest
   * (the owner remembers it); Skip rest ends the rest; Back to the log keeps
   * it running behind the header's readout. Timing is from the absolute
   * timestamp, so a locked or backgrounded phone shows the right time on
   * return.
   */
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';

  interface Props {
    /** When the rest began (the set was saved), in epoch ms. */
    startedAt: number;
    /** The exercise's target rest in seconds; null counts up, as in v0, without the band. */
    targetS: number | null;
    /** "Bench press · set 2 of 4 done". */
    context: string;
    /** The set that comes next, or null when none is left. */
    next: { label: string; figures: string; exercise: string } | null;
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
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });

  const elapsed = $derived(Math.max(0, Math.floor((now - startedAt) / 1000)));
  const left = $derived(targetS === null ? null : targetS - elapsed);
  const over = $derived(left !== null && left <= 0);
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const shown = $derived(left === null ? clock(elapsed) : over ? `+${clock(-left)}` : clock(left));
</script>

<div class="rest" class:over role="dialog" aria-modal="true" aria-label="Rest">
  <div class="top">
    <span class="label">{over ? 'Rest over' : 'Rest'}</span>
    <span class="tools">
      <button
        class="icon-btn"
        aria-pressed={chime}
        aria-label="Chime at zero"
        onclick={() => onchime(!chime)}><Icon name={chime ? 'bell' : 'bellOff'} /></button
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
  <p class="time figure-num" role="timer">{shown}</p>
  {#if targetS !== null}<p class="of">of {clock(targetS)}</p>{/if}

  <div class="adjust">
    <button class="figure-num" onclick={() => onadjust(-15)}>−15 s</button>
    <button class="figure-num" onclick={() => onadjust(15)}>+15 s</button>
    <button class="caps" onclick={onskip}>Skip rest</button>
  </div>

  {#if next}
    <div class="next">
      <p class="caps">Next</p>
      <p><span class="meta">{next.label}</span> <b class="figure-num">{next.figures}</b></p>
      <p class="meta">{next.exercise}</p>
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
    background: var(--rest-field);
    color: var(--rest-ink);
  }

  .over {
    background: var(--rest-over);
    color: var(--rest-over-ink);
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

  .tools .icon-btn {
    color: var(--rest-muted);
  }

  .tools .icon-btn[aria-pressed='true'] {
    background: var(--rest-surface);
    color: var(--rest-ink);
  }

  .context {
    font-style: italic;
    text-align: center;
    color: var(--rest-muted);
  }

  .time {
    margin-top: var(--space-8);
    font-size: var(--fs-rest);
    letter-spacing: -0.01em;
    text-align: center;
    white-space: nowrap;
  }

  .of {
    font: italic 1.25rem / 1.2 var(--font-text);
    text-align: center;
    color: var(--rest-muted);
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

  .next .caps {
    color: var(--rest-accent);
  }

  .next .meta {
    color: var(--rest-muted);
  }

  .next b {
    font-size: 1.875rem;
  }

  .rest :global(.button-primary) {
    background: var(--rest-ink);
    color: var(--rest-field);
    box-shadow:
      0 0 0 2px var(--rest-field),
      0 0 0 3.5px var(--rest-ink);
  }
</style>

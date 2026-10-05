<script lang="ts">
  /**
   * The finish screen, at `#/session/<id>/finish`, replacing the session once
   * it is finished: the boulder arrives at the top, "The boulder is at the
   * top.", the stats (minutes, sets, kg, records), each exercise's top set,
   * the Camus line, then Share, Save as template and Done. The share card is
   * drawn as the screen opens, so the tap that shares has its image ready: the
   * share sheet only opens inside the tap.
   */
  import { onMount } from 'svelte';
  import type { Exercise, Session } from '../../model';
  import { recordsSetInSession } from '../../metrics/records';
  import { app } from '../app.svelte';
  import Boulder from '../kit/Boulder.svelte';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import Laurel from '../kit/Laurel.svelte';
  import Meander from '../kit/Meander.svelte';
  import { overlays, promptDialog, showToast } from '../overlays.svelte';
  import {
    cardContent,
    defaultTemplateName,
    renderShareCard,
    shareFileName,
    shareImage,
    summarise,
  } from '../sharecard';
  import ShareSheet from './ShareSheet.svelte';

  interface Props {
    /** The session just finished (`ended_at` set). */
    session: Session;
    library: Exercise[];
    /** Every session, for the records set today. */
    sessions: Session[];
    /** Leaves for Train. */
    ondone: () => void;
    /** Saves the session as a template of this name. */
    onsavetemplate: (name: string) => void | Promise<void>;
    /**
     * Told when the lifter taps Share, after the card is handled here. The
     * screen draws and shares the card itself, so the shell needs nothing.
     */
    onshare?: () => void;
  }
  let { session, library, sessions, ondone, onsavetemplate, onshare }: Props = $props();

  const recordIds = $derived(
    new Set(
      recordsSetInSession(session, sessions, library, app.manualRecords).map((e) => e.set_id),
    ),
  );
  const summary = $derived(summarise(session, library, recordIds));

  // --- the share card ---------------------------------------------------------------

  let card = $state.raw<Promise<Blob> | null>(null);
  let cardBlob = $state.raw<Blob | null>(null);
  let sheet = $state(false);

  function draw(): void {
    const drawing = renderShareCard(cardContent(session, summary));
    card = drawing;
    drawing.then(
      (blob) => {
        if (card === drawing) cardBlob = blob;
      },
      () => {
        if (card === drawing) cardBlob = null;
      },
    );
  }

  onMount(() => {
    draw();
    // The card wears the colours of the mode it is drawn in, so a switch redraws it.
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    dark.addEventListener('change', draw);
    return () => dark.removeEventListener('change', draw);
  });

  async function share(): Promise<void> {
    onshare?.();
    let blob: Blob;
    try {
      blob = await (card ?? renderShareCard(cardContent(session, summary)));
    } catch {
      showToast({ message: 'The card could not be drawn' });
      return;
    }
    const outcome = await shareImage(blob, shareFileName(session.date), 'Sisyphos');
    if (outcome === 'unsupported') {
      cardBlob = blob;
      sheet = true;
    }
  }

  async function saveTemplate(): Promise<void> {
    const name = await promptDialog({
      title: 'Save as a template',
      label: 'Name',
      value: defaultTemplateName(session),
      confirmLabel: 'Save template',
    });
    if (name) await onsavetemplate(name);
  }
</script>

<article class="finish" class:toasting={overlays.toast !== null}>
  <Meander color="var(--figure)" />
  <Boulder size="hero" arrived label="The boulder at the top of the hill" />
  <div class="body">
    <h1>The boulder is at the top.</h1>

    <dl class="stats">
      {#each summary.stats as stat (stat.label)}
        <div>
          <dt class="caps">{stat.label}</dt>
          <dd class="figure-num">
            {#if stat.laurel}<Laurel size={20} />{/if}{stat.value}
          </dd>
        </div>
      {/each}
    </dl>

    {#if summary.rows.length > 0}
      <ul class="tops">
        {#each summary.rows as row (row.exercise_id)}
          <li>
            <span class="name">{row.name}</span>
            <span class="leader" aria-hidden="true"></span>
            <span class="set figure-num">
              {#if row.record}<Laurel label="Record" />{/if}
              {row.figures}{#if row.rpe}<span class="rpe"> @ {row.rpe}</span>{/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <p class="wit">
      <span class="meta">One must imagine Sisyphos happy.</span>
      <cite class="caps">Camus</cite>
    </p>

    <div class="acts">
      <div class="pair">
        <Button onclick={share}><Icon name="share" size="sm" /> Share</Button>
        <Button onclick={saveTemplate}>Save as template</Button>
      </div>
      <Button variant="primary" bench full onclick={ondone}>Done</Button>
    </div>
  </div>
</article>

<ShareSheet
  open={sheet}
  blob={cardBlob}
  fileName={shareFileName(session.date)}
  onclose={() => (sheet = false)}
/>

<style>
  .finish {
    display: flex;
    flex-direction: column;
    min-height: calc(100dvh - var(--safe-top) - var(--safe-bottom));
    padding-top: var(--space-3);
    color: var(--figure);
  }

  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: var(--space-4) var(--gutter) var(--space-6);
    color: var(--ink);
  }

  h1 {
    max-width: 300px;
    margin: 0 auto;
    text-align: center;
    text-transform: uppercase;
    line-height: 1.3;
    text-wrap: balance;
  }

  .stats {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    margin: var(--space-4) 0 0;
    border-block: var(--hairline) solid var(--line-strong);
  }

  .stats div {
    display: flex;
    flex-direction: column-reverse;
    align-items: center;
    padding: var(--space-3) 0;
  }

  .stats div + div {
    border-left: var(--hairline) solid var(--line);
  }

  dd {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-size: 2rem;
  }

  dt {
    color: var(--muted);
  }

  .tops {
    margin: var(--space-3) 0 0;
    padding: 0;
    list-style: none;
  }

  .tops li {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-height: 44px;
    padding: var(--space-2) 0;
    border-bottom: var(--hairline) solid var(--line);
  }

  .name {
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
  }

  .leader {
    flex: 1;
    min-width: var(--space-4);
    border-bottom: 1.5px dotted var(--line-strong);
    transform: translateY(-3px);
  }

  .set {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 1.125rem;
    white-space: nowrap;
  }

  .rpe {
    color: var(--accent);
  }

  .wit {
    margin: var(--space-5) 0 0;
    text-align: center;
  }

  .wit .meta {
    display: block;
    font-size: var(--fs-meta);
  }

  .wit cite {
    display: block;
    margin-top: 2px;
    font-style: normal;
    color: var(--muted);
  }

  .acts {
    display: grid;
    gap: var(--space-3);
    margin-top: auto;
    padding-top: var(--space-6);
    /* Done stays in reach on a long list, and a toast (which sits over the foot) lifts it clear. */
    position: sticky;
    bottom: var(--safe-bottom);
    padding-bottom: var(--space-2);
    background: linear-gradient(transparent, var(--ground) var(--space-6));
    transition: bottom var(--dur-fast) var(--ease-out);
  }

  .toasting .acts {
    bottom: calc(var(--safe-bottom) + 72px);
  }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
</style>

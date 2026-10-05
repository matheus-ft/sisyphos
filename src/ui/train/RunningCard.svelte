<script lang="ts">
  import type { Session } from '../../model';
  import { app } from '../app.svelte';
  import { formatMinutes, programLabel, sessionMinutes } from '../format';
  import Boulder from '../kit/Boulder.svelte';
  import Button from '../kit/Button.svelte';
  import { climb } from '../session/flow';

  /**
   * The session being lifted, first on Train whenever there is one: how long,
   * how many sets, the boulder where it stands, and the way back in.
   */
  interface Props {
    session: Session;
  }
  let { session }: Props = $props();

  // Minutes are whole, so a quarter-minute tick is enough to keep them true.
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(id);
  });

  const minutes = $derived(sessionMinutes(session, now));
  // The same climb as the session's own header, so the two never disagree.
  const tally = $derived(climb(session, app.sessions));
  const label = $derived(programLabel(session.label));
</script>

<article class="card card-current" aria-label="Session in progress">
  {#if label}<p class="label caps">{label}</p>{/if}
  <div class="body">
    <dl class="stats">
      <div>
        <dt class="caps">Elapsed</dt>
        <dd class="figure-num">
          {#if minutes === null}—{:else if minutes < 60}{minutes}<span class="of">min</span
            >{:else}{formatMinutes(minutes)}{/if}
        </dd>
      </div>
      <div>
        <dt class="caps">Sets</dt>
        <dd class="figure-num">
          {tally.done}<span class="of">of {tally.of}</span>
        </dd>
      </div>
    </dl>
    <div class="hill">
      <Boulder progress={tally.fraction} size="header" label={null} />
    </div>
  </div>
  <Button variant="primary" bench full onclick={() => app.openSession(session)}
    >Return to session</Button
  >
</article>

<style>
  article {
    margin: 0 12px;
    display: grid;
    gap: var(--space-3);
  }

  .label {
    color: var(--accent);
  }

  .body {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: end;
    gap: var(--space-4);
  }

  .stats {
    display: grid;
    gap: var(--space-3);
    margin: 0;
  }

  dt {
    color: var(--ink-2);
  }

  dd {
    margin: 4px 0 0;
    font-size: var(--fs-row-active);
  }

  .of {
    margin-left: 0.3em;
    font: italic var(--fw-text) var(--fs-meta) / 1 var(--font-text);
    color: var(--ink-2);
  }

  .hill {
    justify-self: end;
    width: 100%;
    max-width: 180px;
  }
</style>

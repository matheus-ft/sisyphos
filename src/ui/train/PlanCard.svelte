<script lang="ts">
  import type { Session } from '../../model';
  import { app } from '../app.svelte';
  import { programLabel } from '../format';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import { exerciseLines } from '../template';
  import { sessionName } from '../train';

  /**
   * A planned session as a card: its program label, what it is called, the
   * exercises with their targets, and Start. The text opens the plan to edit
   * it; Start is the screen's one primary unless a session is already running.
   */
  interface Props {
    session: Session;
    /** The one primary of the screen; false leaves Start quiet. */
    primary?: boolean;
  }
  let { session, primary = true }: Props = $props();

  const names = $derived(new Map(app.library.map((e) => [e.id, e.name])));
  const label = $derived(programLabel(session.label));
  const lines = $derived(exerciseLines(session.exercises, names));
  const running = $derived(app.running !== null);
</script>

<article class="card">
  <button class="open" onclick={() => app.openSession(session)}>
    {#if label}<span class="label caps"
        >{#each label.split(' · ') as part, i (i)}{#if i > 0}{'\u00a0· '}{/if}<span class="part"
            >{part}</span
          >{/each}</span
      >{/if}
    <span class="head">
      <h2>{sessionName(session, app.library)}</h2>
      <Icon name="chev" size="sm" />
    </span>
    <span class="meta">{lines.length ? lines.join(' · ') : 'No exercises yet'}</span>
  </button>
  {#if !running}
    <Button
      variant={primary ? 'primary' : 'quiet'}
      bench
      full
      onclick={() => app.startPlanned(session)}>Start</Button
    >
  {/if}
</article>

<style>
  article {
    margin: 0 12px;
    display: grid;
    gap: var(--space-3);
  }

  .open {
    display: grid;
    gap: 4px;
    min-height: var(--tap);
    width: 100%;
    text-align: left;
    color: inherit;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .head :global(.ico) {
    flex: none;
    color: var(--muted);
  }

  /* A label too long for one line breaks after a dot, never inside "week 6", and evenly. */
  .label {
    color: var(--accent);
    text-wrap: balance;
  }

  .part {
    white-space: nowrap;
  }

  h2 {
    font: var(--fw-strong) var(--fs-lead) / var(--lh-snug) var(--font-text);
    letter-spacing: 0;
  }
</style>

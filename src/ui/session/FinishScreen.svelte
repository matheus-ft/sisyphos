<script lang="ts">
  /**
   * CONTRACT STUB, filled by wave 1 (rest/finish/share package). The props
   * below are the final interface; the body is a minimal working placeholder.
   *
   * The finish screen, at `#/session/<id>/finish`, replacing the session once
   * it is finished: the boulder arrives at the top, "The boulder is at the
   * top.", the stats (minutes, sets, kg, records), each exercise's top set,
   * the Camus line when the wit rule allows, then Share, Save as template and
   * Done.
   */
  import type { Exercise, Session } from '../../model';
  import { formatMinutes, sessionMinutes, workingSets } from '../format';
  import Boulder from '../kit/Boulder.svelte';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import Meander from '../kit/Meander.svelte';
  import { promptDialog } from '../overlays.svelte';

  interface Props {
    /** The session just finished (`ended_at` set). */
    session: Session;
    library: Exercise[];
    /** Every session, for records set today and the wit rule. */
    sessions: Session[];
    /** Leaves for Train. */
    ondone: () => void;
    /** Saves the session as a template of this name. */
    onsavetemplate: (name: string) => void | Promise<void>;
    /** Draws the share card and opens the share sheet. */
    onshare: () => void;
  }
  // library and sessions are for the records and the wit rule, which the stub does not show yet.
  let { session, ondone, onsavetemplate, onshare }: Props = $props();

  const minutes = $derived(sessionMinutes(session));
  const sets = $derived(workingSets(session));

  async function saveTemplate(): Promise<void> {
    const name = await promptDialog({
      title: 'Save as a template',
      label: 'Name',
      confirmLabel: 'Save template',
    });
    if (name) await onsavetemplate(name);
  }
</script>

<article class="finish">
  <Meander color="var(--figure)" />
  <Boulder size="hero" arrived label="The boulder at the top of the hill" />
  <div class="body">
    <h1>The boulder is at the top.</h1>
    <dl class="stats">
      {#if minutes !== null}
        <div>
          <dt class="caps">Min</dt>
          <dd class="figure-num">{formatMinutes(minutes).replace(' min', '')}</dd>
        </div>
      {/if}
      <div>
        <dt class="caps">Sets</dt>
        <dd class="figure-num">{sets}</dd>
      </div>
    </dl>
    <div class="acts">
      <div class="pair">
        <Button onclick={onshare}><Icon name="share" size="sm" /> Share</Button>
        <Button onclick={saveTemplate}>Save as template</Button>
      </div>
      <Button variant="primary" bench full onclick={ondone}>Done</Button>
    </div>
  </div>
</article>

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
    margin: 0;
    font-size: 2rem;
  }

  dt {
    color: var(--muted);
  }

  .acts {
    display: grid;
    gap: var(--space-3);
    margin-top: auto;
    padding-top: var(--space-6);
  }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
</style>

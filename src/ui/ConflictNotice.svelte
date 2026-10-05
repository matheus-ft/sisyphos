<script lang="ts">
  import { app } from './app.svelte';
  import { conflictSubject, exerciseNames, libraryConflictSubject, noticeCopy } from './conflicts';
  import Button from './kit/Button.svelte';
  import Icon from './kit/Icon.svelte';
  import Meander from './kit/Meander.svelte';

  /**
   * The full-screen notice that two devices changed the same thing: how many,
   * that nothing was lost, what each is about, and a way to Review them or
   * leave them for Later.
   * The shell shows it after a sync that finds some and at every launch until
   * none are left, never during a session (conflicts.ts, noticeShown).
   */
  interface Props {
    count: number;
    onreview: () => void;
    onlater: () => void;
  }
  let { count, onreview, onlater }: Props = $props();

  const copy = $derived(noticeCopy(count));

  /** What each conflict is about, so the lifter knows what is at stake before Review. */
  let subjects = $state<string[]>([]);
  $effect(() => {
    void count;
    void list();
  });

  async function list(): Promise<void> {
    const storage = app.storage;
    if (!storage) return;
    const names = exerciseNames(app.library);
    const records = await storage.log.getConflicts();
    const library = (await storage.log.library()).conflicts;
    subjects = [
      ...records.map((r) => conflictSubject(r, names)),
      ...library.map(libraryConflictSubject),
    ];
  }

  /** Lands a screen reader on the news, and the keyboard beside the actions. */
  function arrive(node: HTMLElement): void {
    node.focus({ preventScroll: true });
  }
</script>

<div
  class="notice"
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="notice-title"
  aria-describedby="notice-line"
>
  <div class="body">
    <div class="rule"><Meander framed /></div>
    <span class="mark"><Icon name="conflict" size={40} /></span>
    <h1 id="notice-title" tabindex="-1" use:arrive>{copy.title}</h1>
    <p id="notice-line" class="line">{copy.line}</p>
    {#if subjects.length > 0}
      <ul class="subjects">
        {#each subjects as subject, i (i)}<li>{subject}</li>{/each}
      </ul>
    {/if}
    <div class="acts">
      <Button variant="primary" full onclick={onreview}>Review</Button>
      <Button variant="link" onclick={onlater}>Later</Button>
    </div>
  </div>
</div>

<style>
  .notice {
    position: fixed;
    inset: 0;
    z-index: var(--z-takeover);
    overflow-y: auto;
    padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
    background: var(--raised);
  }

  .body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: 40rem;
    margin: 0 auto;
    padding: max(var(--space-16), 16dvh) var(--gutter) var(--space-8);
  }

  .rule {
    width: 100%;
    margin-bottom: var(--space-8);
    color: var(--warning);
  }

  .mark {
    display: inline-flex;
    margin-bottom: var(--space-4);
    color: var(--warning);
  }

  h1 {
    font: var(--fw-display) var(--fs-title) / var(--lh-snug) var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
  }

  h1:focus {
    outline: none;
  }

  .line {
    margin-top: var(--space-3);
    color: var(--ink-2);
    font-size: var(--fs-lead);
    max-width: 30ch;
  }

  .subjects {
    width: 100%;
    margin: var(--space-6) 0 0;
    padding: 0;
    list-style: none;
    border-top: var(--hairline) solid var(--line);
  }

  .subjects li {
    padding: var(--space-3) 0;
    border-bottom: var(--hairline) solid var(--line);
  }

  .acts {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
    width: 100%;
    margin-top: var(--space-8);
  }

  /* Later is the quiet way out: centred under the one primary. */
  .acts :global(.button-link),
  .acts > :global(:last-child) {
    align-self: center;
  }
</style>

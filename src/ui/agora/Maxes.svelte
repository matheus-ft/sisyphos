<script lang="ts">
  import type { CompetitionLift, OneRmEntry } from '../../model';
  import { app } from '../app.svelte';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import { kgText, MAX_RANGE, maxProblem, maxViews, parseKg, whenText } from '../lifter';
  import { showToast } from '../overlays.svelte';
  import { localDate } from '../session';
  import EntryForm from './EntryForm.svelte';

  /**
   * The reference max per competition lift: the one in force today and when it
   * was set, its history, a dated entry to add, and beside it the best recent
   * e1RM as a suggestion that only fills the form. Nothing is written until the
   * lifter saves it.
   */

  const today = localDate(new Date());

  const views = $derived(maxViews(app.oneRms, app.current, app.library, app.bodyweights, today));

  /** The lift whose form is open, and what is in it. */
  let adding = $state<CompetitionLift | null>(null);
  let date = $state(today);
  let kg = $state('');
  let note = $state('');
  let problem = $state<string | null>(null);
  let history = $state<CompetitionLift | null>(null);

  function open(lift: CompetitionLift, suggested: number | null = null): void {
    adding = lift;
    date = today;
    kg = suggested === null ? '' : String(suggested);
    note = '';
    problem = null;
  }

  async function add(lift: CompetitionLift): Promise<void> {
    problem = maxProblem(date, kg, today);
    if (problem) return;
    const entry: OneRmEntry = {
      date,
      lift,
      weight_kg: parseKg(kg, MAX_RANGE)!,
      note: note.trim() === '' ? null : note.trim(),
    };
    const replaced = app.oneRms.find((e) => e.date === date && e.lift === lift) ?? null;
    if (!(await app.saveRow('oneRm', entry))) return;
    adding = null;
    showToast({
      message: `${cap(lift)} max ${replaced ? 'replaced' : 'saved'}`,
      strong: `${kgText(entry.weight_kg)} kg`,
      action: {
        label: 'Undo',
        run: () => void (replaced ? app.saveRow('oneRm', replaced) : app.removeRow('oneRm', entry)),
      },
    });
  }

  async function remove(entry: OneRmEntry): Promise<void> {
    if (!(await app.removeRow('oneRm', entry))) return;
    showToast({
      message: `${cap(entry.lift)} max deleted`,
      strong: `${kgText(entry.weight_kg)} kg · ${whenText(entry.date, today)}`,
      action: { label: 'Undo', run: () => void app.saveRow('oneRm', entry) },
    });
  }

  const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
</script>

<section id="maxes" aria-labelledby="maxes-h">
  <h2 id="maxes-h" class="visually-hidden">Reference maxes</h2>
  {#each views as view (view.lift)}
    <p class="sec caps">Reference max · {view.lift}</p>
    <div class="card max">
      <div class="top">
        <div class="now">
          {#if view.inForce}
            <span class="kg figure-num"
              >{kgText(view.inForce.weight_kg)}<span class="unit">kg</span></span
            >
            <span class="meta">set {whenText(view.inForce.date, today)}</span>
          {:else}
            <span class="meta">None set yet</span>
          {/if}
        </div>
        {#if view.suggestion}
          <div class="suggest">
            <span class="meta">recent best e1RM {view.suggestion.kg}</span>
            <Button variant="link" onclick={() => open(view.lift, view.suggestion!.kg)}
              >Use {view.suggestion.kg}</Button
            >
          </div>
        {/if}
      </div>
      <div class="tools">
        <Button variant="link" onclick={() => open(view.lift)}>New entry</Button>
        {#if view.history.length > 1}
          <Button
            variant="link"
            aria-expanded={history === view.lift}
            onclick={() => (history = history === view.lift ? null : view.lift)}
            >History ({view.history.length})</Button
          >
        {/if}
      </div>
    </div>

    {#if adding === view.lift}
      <EntryForm
        submitLabel="Save {view.lift} max"
        {problem}
        onsubmit={() => add(view.lift)}
        oncancel={() => (adding = null)}
      >
        <div class="field">
          <label for="max-date-{view.lift}">From</label>
          <input id="max-date-{view.lift}" type="date" bind:value={date} max={today} />
        </div>
        <div class="field">
          <label for="max-kg-{view.lift}">Max, kg</label>
          <input
            id="max-kg-{view.lift}"
            bind:value={kg}
            inputmode="decimal"
            autocomplete="off"
            placeholder="150"
          />
        </div>
        <div class="field wide">
          <label for="max-note-{view.lift}">Note, if any</label>
          <input
            id="max-note-{view.lift}"
            bind:value={note}
            autocomplete="off"
            placeholder="Meet, test day, estimate"
          />
        </div>
      </EntryForm>
    {/if}

    {#if history === view.lift}
      <ul class="group">
        {#each view.history as entry (entry.date)}
          <li>
            <span class="grow">
              <span class="t">{whenText(entry.date, today)}</span>
              {#if entry.note}<span class="s">{entry.note}</span>{/if}
            </span>
            <span class="kg figure-num">{kgText(entry.weight_kg)}<span class="unit">kg</span></span>
            <button
              class="icon-btn gone"
              aria-label="Delete the {view.lift} max of {whenText(entry.date, today)}"
              onclick={() => remove(entry)}><Icon name="close" size="sm" /></button
            >
          </li>
        {/each}
      </ul>
    {/if}
  {/each}
</section>

<style>
  .sec {
    text-transform: uppercase;
  }

  .max {
    display: grid;
    gap: var(--space-1);
    margin: 0 12px var(--space-3);
    padding: var(--space-3) var(--space-4) 0;
  }

  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .now {
    display: grid;
  }

  .kg {
    font-size: var(--fs-row);
    line-height: var(--lh-tight);
  }

  .unit {
    margin-left: 0.25em;
    font: italic var(--fs-meta) var(--font-text);
    color: var(--muted);
  }

  .suggest {
    display: grid;
    justify-items: end;
    text-align: right;
  }

  /* The link is the 44 floor tall; pull it toward its caption so the pair reads as one. */
  .suggest :global(.button-link) {
    margin-top: -12px;
    margin-right: calc(-1 * var(--space-2));
  }

  .tools {
    display: flex;
    justify-content: space-between;
    margin: -8px calc(-1 * var(--space-2)) 0;
  }

  .gone {
    margin-right: calc(-1 * var(--space-2));
    color: var(--muted);
  }
</style>

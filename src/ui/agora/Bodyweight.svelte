<script lang="ts">
  import type { BodyweightEntry } from '../../model';
  import { app } from '../app.svelte';
  import { longDate } from '../format';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import {
    changeText,
    kgText,
    parseKg,
    BODYWEIGHT_RANGE,
    weighInProblem,
    weighIns,
  } from '../lifter';
  import { showToast } from '../overlays.svelte';
  import { localDate } from '../session';
  import EntryForm from './EntryForm.svelte';

  /** Weigh-ins, newest first, each with its change from the one before. */

  const today = localDate(new Date());
  /** Past this many the list folds, so a year of weigh-ins does not push the maxes off screen. */
  const SHOWN = 6;

  let adding = $state(false);
  let date = $state(today);
  let kg = $state('');
  let problem = $state<string | null>(null);
  let all = $state(false);

  const rows = $derived(weighIns(app.bodyweights));
  const visible = $derived(all ? rows : rows.slice(0, SHOWN));

  function open(): void {
    // Starting from the last weight is what the next weigh-in most nearly is.
    date = today;
    kg = '';
    problem = null;
    adding = true;
  }

  async function add(): Promise<void> {
    problem = weighInProblem(date, kg, today);
    if (problem) return;
    const entry: BodyweightEntry = {
      date,
      weight_kg: parseKg(kg, BODYWEIGHT_RANGE)!,
      source: 'manual',
    };
    const replaced = app.bodyweights.find((e) => e.date === date) ?? null;
    if (!(await app.saveRow('bodyweight', entry))) return;
    adding = false;
    showToast({
      message: replaced ? 'Weigh-in replaced' : 'Weigh-in saved',
      strong: `${kgText(entry.weight_kg)} kg`,
      action: {
        label: 'Undo',
        run: () =>
          void (replaced
            ? app.saveRow('bodyweight', replaced)
            : app.removeRow('bodyweight', entry)),
      },
    });
  }

  async function remove(entry: BodyweightEntry): Promise<void> {
    if (!(await app.removeRow('bodyweight', entry))) return;
    showToast({
      message: 'Weigh-in deleted',
      strong: `${kgText(entry.weight_kg)} kg · ${longDate(entry.date)}`,
      action: { label: 'Undo', run: () => void app.saveRow('bodyweight', entry) },
    });
  }
</script>

<section id="bodyweight" aria-labelledby="bodyweight-h">
  <div class="sec">
    <h2 id="bodyweight-h" class="caps">Bodyweight</h2>
    {#if !adding}<Button variant="link" caps onclick={open}>Add weigh-in</Button>{/if}
  </div>

  {#if adding}
    <EntryForm
      submitLabel="Save weigh-in"
      {problem}
      onsubmit={add}
      oncancel={() => (adding = false)}
    >
      <div class="field">
        <label for="bw-date">Date</label>
        <input id="bw-date" type="date" bind:value={date} max={today} />
      </div>
      <div class="field">
        <label for="bw-kg">Weight, kg</label>
        <input
          id="bw-kg"
          bind:value={kg}
          inputmode="decimal"
          autocomplete="off"
          placeholder="83.4"
        />
      </div>
    </EntryForm>
  {/if}

  {#if rows.length === 0}
    {#if !adding}<p class="meta none">No weigh-ins yet.</p>{/if}
  {:else}
    <ul class="group">
      {#each visible as { entry, change } (entry.date)}
        <li>
          <span class="grow">
            <span class="t">{longDate(entry.date)}</span>
            {#if change !== null}<span class="s">{changeText(change)} kg</span>{/if}
          </span>
          <span class="kg figure-num">{kgText(entry.weight_kg)}<span class="unit"> kg</span></span>
          <button
            class="icon-btn gone"
            aria-label="Delete the weigh-in of {longDate(entry.date)}"
            onclick={() => remove(entry)}><Icon name="close" size="sm" /></button
          >
        </li>
      {/each}
      {#if rows.length > SHOWN}
        <li class="row-link">
          <button onclick={() => (all = !all)}>
            <span class="grow t more">{all ? 'Show fewer' : `Show all ${rows.length}`}</span>
          </button>
        </li>
      {/if}
    </ul>
  {/if}
</section>

<style>
  .sec {
    align-items: center;
  }

  h2 {
    margin: 0;
  }

  .none {
    margin: 0 var(--gutter);
  }

  .kg {
    font-size: var(--fs-row);
  }

  .unit {
    font: italic var(--fs-meta) var(--font-text);
    color: var(--muted);
  }

  .gone {
    margin-right: calc(-1 * var(--space-2));
    color: var(--muted);
  }

  .more {
    color: var(--accent);
  }
</style>

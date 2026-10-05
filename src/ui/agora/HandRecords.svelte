<script lang="ts">
  import type { ManualRecord } from '../../model';
  import { RECORD_MAX_REPS } from '../../metrics/definitions';
  import { app } from '../app.svelte';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import {
    RECORD_RPES,
    recordFigures,
    recordFrom,
    recordProblem,
    recordsNewestFirst,
    whenText,
    type RecordForm,
  } from '../lifter';
  import { showToast } from '../overlays.svelte';
  import { localDate } from '../session';
  import EntryForm from './EntryForm.svelte';
  import ExerciseSheet from './ExerciseSheet.svelte';

  /**
   * Records entered by hand: a lift from before the log, or from a meet. They
   * join the Labours record book with the ones the sessions set.
   */

  const today = localDate(new Date());
  const empty = (): RecordForm => ({
    exerciseId: null,
    reps: '1',
    kg: '',
    date: today,
    rpe: '',
    context: '',
  });

  let adding = $state(false);
  let form = $state<RecordForm>(empty());
  let problem = $state<string | null>(null);
  let picking = $state(false);

  const rows = $derived(recordsNewestFirst(app.manualRecords));
  const names = $derived(new Map(app.library.map((e) => [e.id, e.name])));
  const chosen = $derived(form.exerciseId ? (names.get(form.exerciseId) ?? form.exerciseId) : null);

  function open(): void {
    form = empty();
    problem = null;
    adding = true;
  }

  async function add(): Promise<void> {
    problem = recordProblem(form, today);
    if (problem) return;
    const record = recordFrom(form);
    const replaced =
      app.manualRecords.find(
        (r) =>
          r.date === record.date && r.exercise_id === record.exercise_id && r.reps === record.reps,
      ) ?? null;
    if (!(await app.saveRow('manualRecords', record))) return;
    adding = false;
    showToast({
      message: replaced ? 'Record replaced' : 'Record saved',
      strong: `${names.get(record.exercise_id) ?? record.exercise_id} · ${record.reps} × ${record.weight_kg} kg`,
      action: {
        label: 'Undo',
        run: () =>
          void (replaced
            ? app.saveRow('manualRecords', replaced)
            : app.removeRow('manualRecords', record)),
      },
    });
  }

  async function remove(record: ManualRecord): Promise<void> {
    if (!(await app.removeRow('manualRecords', record))) return;
    showToast({
      message: 'Record deleted',
      strong: `${names.get(record.exercise_id) ?? record.exercise_id} · ${record.reps} × ${record.weight_kg} kg`,
      action: { label: 'Undo', run: () => void app.saveRow('manualRecords', record) },
    });
  }
</script>

<section id="records" aria-labelledby="records-h">
  <div class="sec">
    <h2 id="records-h" class="caps">Records by hand</h2>
    {#if !adding}<Button variant="link" caps onclick={open}>Add record</Button>{/if}
  </div>

  {#if adding}
    <EntryForm submitLabel="Save record" {problem} onsubmit={add} oncancel={() => (adding = false)}>
      <div class="field wide">
        <span class="label" id="rec-ex-l">Exercise</span>
        <button
          type="button"
          class="pick"
          aria-labelledby="rec-ex-l rec-ex"
          onclick={() => (picking = true)}
        >
          <span id="rec-ex" class:placeholder={!chosen}>{chosen ?? 'Choose an exercise'}</span>
          <Icon name="down" size="sm" />
        </button>
      </div>
      <div class="field">
        <label for="rec-reps">Reps</label>
        <select id="rec-reps" bind:value={form.reps}>
          {#each Array.from({ length: RECORD_MAX_REPS }, (_, i) => i + 1) as n (n)}
            <option value={String(n)}>{n}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="rec-kg">Weight, kg</label>
        <input
          id="rec-kg"
          bind:value={form.kg}
          inputmode="decimal"
          autocomplete="off"
          placeholder="155"
        />
      </div>
      <div class="field">
        <label for="rec-date">Date</label>
        <input id="rec-date" type="date" bind:value={form.date} max={today} />
      </div>
      <div class="field">
        <label for="rec-rpe">RPE, if known</label>
        <select id="rec-rpe" bind:value={form.rpe}>
          <option value="">none</option>
          {#each RECORD_RPES as rpe (rpe)}<option value={String(rpe)}>{rpe}</option>{/each}
        </select>
      </div>
      <div class="field wide">
        <label for="rec-context">Where, if you like</label>
        <input
          id="rec-context"
          bind:value={form.context}
          autocomplete="off"
          placeholder="Nationals 2026"
        />
      </div>
    </EntryForm>
  {/if}

  {#if rows.length === 0}
    {#if !adding}
      <p class="meta none">
        A lift from before the log, or from a meet, goes here and joins your records.
      </p>
    {/if}
  {:else}
    <ul class="group">
      {#each rows as record (`${record.date}/${record.exercise_id}/${record.reps}`)}
        {@const figures = recordFigures(record)}
        <li>
          <span class="grow">
            <span class="t">{names.get(record.exercise_id) ?? record.exercise_id}</span>
            <span class="s"
              >{whenText(record.date, today)}{record.context ? ` · ${record.context}` : ''}</span
            >
          </span>
          <span class="fig figure-num"
            >{figures.text}{#if figures.rpe}<span class="rpe"> {figures.rpe}</span>{/if}</span
          >
          <button
            class="icon-btn gone"
            aria-label="Delete the record of {record.reps} × {record.weight_kg} kg on {whenText(
              record.date,
              today,
            )}"
            onclick={() => remove(record)}><Icon name="close" size="sm" /></button
          >
        </li>
      {/each}
    </ul>
  {/if}
</section>

<ExerciseSheet
  open={picking}
  library={app.library}
  current={form.exerciseId}
  onpick={(exercise) => {
    form.exerciseId = exercise.id;
    picking = false;
  }}
  onclose={() => (picking = false)}
/>

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

  .pick {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    border-bottom: var(--hairline) solid var(--line-strong);
    text-align: left;
  }

  .placeholder {
    color: var(--muted);
  }

  .fig {
    font-size: var(--fs-row);
    white-space: nowrap;
  }

  .rpe {
    font-size: var(--fs-meta);
    color: var(--ink-2);
  }

  .gone {
    margin-right: calc(-1 * var(--space-2));
    color: var(--muted);
  }
</style>

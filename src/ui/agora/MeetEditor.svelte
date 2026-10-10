<script lang="ts">
  import type { CompetitionLift, Exercise } from '../../model';
  import Button from '../kit/Button.svelte';
  import { LIFTS } from '../lifter';
  import {
    EQUIPMENT_SUGGESTIONS,
    LIFT_NAMES,
    meetExercises,
    rowExercise,
    withRowExercise,
    type MeetForm,
  } from '../meets';
  import EntryForm from './EntryForm.svelte';

  /**
   * One meet, entered or changed: what is known about it, then the attempts as
   * a 3 × 3 grid (a row for each lift, a column for each attempt). A row has
   * one exercise to choose, from that lift's competition exercises, so sumo and
   * conventional stay apart; an attempt is a weight, left empty when it was not
   * taken, and whether the judges passed it. A meet already saved can be deleted.
   */
  interface Props {
    form: MeetForm;
    library: readonly Exercise[];
    today: string;
    problem: string | null;
    /** An existing meet: the button that deletes it. */
    ondelete?: (() => void) | null;
    onsubmit: () => void;
    oncancel: () => void;
  }
  let {
    form = $bindable(),
    library,
    today,
    problem,
    ondelete = null,
    onsubmit,
    oncancel,
  }: Props = $props();

  const uid = $props.id();

  function pick(lift: CompetitionLift, id: string): void {
    form = withRowExercise(form, lift, id);
  }
</script>

<EntryForm submitLabel={ondelete ? 'Save meet' : 'Add meet'} {problem} {onsubmit} {oncancel}>
  <div class="field wide">
    <label for="{uid}-name">Name</label>
    <input id="{uid}-name" bind:value={form.name} autocomplete="off" placeholder="Nationals 2026" />
  </div>
  <div class="field">
    <label for="{uid}-date">Date</label>
    <input id="{uid}-date" type="date" bind:value={form.date} max={today} />
  </div>
  <div class="field">
    <label for="{uid}-location">Location</label>
    <input id="{uid}-location" bind:value={form.location} autocomplete="off" placeholder="Lisbon" />
  </div>
  <div class="field">
    <label for="{uid}-federation">Federation</label>
    <input
      id="{uid}-federation"
      bind:value={form.federation}
      autocomplete="off"
      placeholder="IPF"
    />
  </div>
  <div class="field">
    <label for="{uid}-class">Weight class</label>
    <input id="{uid}-class" bind:value={form.weightClass} autocomplete="off" placeholder="83 kg" />
  </div>
  <div class="field">
    <label for="{uid}-equipment">Equipment</label>
    <input
      id="{uid}-equipment"
      bind:value={form.equipment}
      list="{uid}-equipment-list"
      autocomplete="off"
      placeholder="raw"
    />
    <datalist id="{uid}-equipment-list">
      {#each EQUIPMENT_SUGGESTIONS as option (option)}<option value={option}></option>{/each}
    </datalist>
  </div>
  <div class="field">
    <label for="{uid}-bw">Bodyweight, kg</label>
    <input
      id="{uid}-bw"
      bind:value={form.bodyweight}
      inputmode="decimal"
      autocomplete="off"
      placeholder="82.6"
    />
  </div>
  <div class="field">
    <label for="{uid}-placing">Placing</label>
    <input
      id="{uid}-placing"
      bind:value={form.placing}
      inputmode="numeric"
      autocomplete="off"
      placeholder="1"
    />
  </div>

  <div class="wide attempts" role="group" aria-labelledby="{uid}-attempts">
    <p class="label" id="{uid}-attempts">Attempts, kg</p>
    {#each LIFTS as lift (lift)}
      <div class="lift">
        <div class="head">
          <label class="caps" for="{uid}-ex-{lift}">{LIFT_NAMES[lift]}</label>
          <select
            id="{uid}-ex-{lift}"
            value={rowExercise(form, lift)}
            onchange={(event) => pick(lift, event.currentTarget.value)}
          >
            {#each meetExercises(library, lift) as exercise (exercise.id)}
              <option value={exercise.id}>{exercise.name}</option>
            {/each}
          </select>
        </div>
        <div class="slots">
          {#each form.lifts[lift] as attempt, i (i)}
            <div class="slot">
              <input
                class="figure-num"
                bind:value={attempt.kg}
                inputmode="decimal"
                autocomplete="off"
                aria-label="{LIFT_NAMES[lift]} attempt {i + 1}, kg"
                placeholder="–"
              />
              <button
                type="button"
                class="verdict"
                class:missed={!attempt.good}
                role="switch"
                aria-checked={attempt.good}
                aria-label="{LIFT_NAMES[lift]} attempt {i + 1} good"
                disabled={attempt.kg.trim() === ''}
                onclick={() => (attempt.good = !attempt.good)}
                >{attempt.good ? 'Good' : 'Missed'}</button
              >
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <div class="field wide">
    <label for="{uid}-notes">Notes, if any</label>
    <textarea id="{uid}-notes" bind:value={form.notes} rows="2"></textarea>
  </div>

  {#if ondelete}
    <div class="wide">
      <Button variant="danger" full onclick={ondelete}>Delete meet</Button>
    </div>
  {/if}
</EntryForm>

<style>
  .attempts {
    display: grid;
    gap: var(--space-3);
  }

  .label {
    margin: 0;
    font: var(--fw-strong) var(--fs-label) / 1 var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
    color: var(--ink-2);
  }

  .lift {
    display: grid;
    gap: var(--space-1);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .head .caps {
    flex: none;
    width: 4.75rem;
  }

  .head select {
    flex: 1;
    min-width: 0;
  }

  .slots {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .slot {
    display: grid;
    gap: var(--space-1);
  }

  .slot input {
    width: 100%;
    min-width: 0;
    text-align: center;
    font-size: var(--fs-row);
  }

  .verdict {
    min-height: 40px;
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-sm);
    font: italic var(--fs-meta) / 1 var(--font-text);
    color: var(--ink);
  }

  .verdict.missed {
    border-color: var(--danger);
    color: var(--danger);
    text-decoration: line-through;
  }

  .verdict:disabled {
    opacity: 0.4;
  }
</style>

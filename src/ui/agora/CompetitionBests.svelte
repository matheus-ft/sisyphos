<script lang="ts">
  import type { CompetitionBest } from '../../model';
  import { app } from '../app.svelte';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import {
    bestsNewestFirst,
    competitionExercises,
    competitionFrom,
    competitionLine,
    competitionProblem,
    kgText,
    whenText,
    type CompetitionForm,
  } from '../lifter';
  import { showToast } from '../overlays.svelte';
  import { localDate } from '../session';
  import EntryForm from './EntryForm.svelte';

  /**
   * The best single of each lift at each meet: what was made on the platform,
   * kept apart from the training records and the reference maxes.
   */

  const today = localDate(new Date());
  const lifts = $derived(competitionExercises(app.library));
  const names = $derived(new Map(app.library.map((e) => [e.id, e.name])));
  const rows = $derived(bestsNewestFirst(app.competitionBests));

  let adding = $state(false);
  let form = $state<CompetitionForm>({ exerciseId: '', kg: '', date: '', meet: '' });
  let problem = $state<string | null>(null);
  /** The meet just entered: a meet has three lifts, entered one after another. */
  let meet = $state<{ date: string; meet: string } | null>(null);

  function open(): void {
    const date = meet?.date ?? today;
    const entered = new Set(
      app.competitionBests.filter((b) => b.date === date).map((b) => b.exercise_id),
    );
    form = {
      exerciseId: (lifts.find((l) => !entered.has(l.id)) ?? lifts[0])?.id ?? '',
      kg: '',
      date,
      meet: meet?.meet ?? '',
    };
    problem = null;
    adding = true;
  }

  const said = (best: CompetitionBest) =>
    `${names.get(best.exercise_id) ?? best.exercise_id} · ${kgText(best.weight_kg)} kg`;

  async function add(): Promise<void> {
    problem = competitionProblem(form, app.library, today);
    if (problem) return;
    const best = competitionFrom(form);
    const replaced =
      app.competitionBests.find(
        (b) => b.date === best.date && b.exercise_id === best.exercise_id,
      ) ?? null;
    if (!(await app.saveRow('competitionBests', best))) return;
    adding = false;
    meet = { date: best.date, meet: best.meet ?? '' };
    showToast({
      message: replaced ? 'Meet best replaced' : 'Meet best saved',
      strong: said(best),
      action: {
        label: 'Undo',
        run: () =>
          void (replaced
            ? app.saveRow('competitionBests', replaced)
            : app.removeRow('competitionBests', best)),
      },
    });
  }

  async function remove(best: CompetitionBest): Promise<void> {
    if (!(await app.removeRow('competitionBests', best))) return;
    showToast({
      message: 'Meet best deleted',
      strong: said(best),
      action: { label: 'Undo', run: () => void app.saveRow('competitionBests', best) },
    });
  }
</script>

<section id="competition" aria-labelledby="competition-h">
  <div class="sec">
    <h2 id="competition-h" class="caps">Competition</h2>
    {#if !adding}<Button variant="link" caps onclick={open}>Add a meet best</Button>{/if}
  </div>

  {#if adding}
    <EntryForm
      submitLabel="Save meet best"
      {problem}
      onsubmit={add}
      oncancel={() => (adding = false)}
    >
      <div class="field wide">
        <label for="meet-lift">Lift</label>
        <select id="meet-lift" bind:value={form.exerciseId}>
          {#each lifts as lift (lift.id)}<option value={lift.id}>{lift.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="meet-kg">Best single, kg</label>
        <input
          id="meet-kg"
          bind:value={form.kg}
          inputmode="decimal"
          autocomplete="off"
          placeholder="180"
        />
      </div>
      <div class="field">
        <label for="meet-date">Date</label>
        <input id="meet-date" type="date" bind:value={form.date} max={today} />
      </div>
      <div class="field wide">
        <label for="meet-name">Meet, if you like</label>
        <input
          id="meet-name"
          bind:value={form.meet}
          autocomplete="off"
          placeholder="Nationals 2026"
        />
      </div>
    </EntryForm>
  {/if}

  {#if rows.length === 0}
    {#if !adding}
      <p class="meta none">
        The heaviest single of each lift at a meet: a number apart from training's.
      </p>
    {/if}
  {:else}
    <ul class="group">
      {#each rows as best (`${best.date}/${best.exercise_id}`)}
        <li>
          <span class="grow">
            <span class="t">{names.get(best.exercise_id) ?? best.exercise_id}</span>
            <span class="s">{competitionLine(best, today)}</span>
          </span>
          <span class="fig figure-num">{kgText(best.weight_kg)} kg</span>
          <button
            class="icon-btn gone"
            aria-label="Delete the meet best of {kgText(best.weight_kg)} kg on {whenText(
              best.date,
              today,
            )}"
            onclick={() => remove(best)}><Icon name="close" size="sm" /></button
          >
        </li>
      {/each}
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

  .fig {
    font-size: var(--fs-row);
    white-space: nowrap;
  }

  .gone {
    margin-right: calc(-1 * var(--space-2));
    color: var(--muted);
  }
</style>

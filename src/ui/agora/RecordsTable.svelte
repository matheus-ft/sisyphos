<script lang="ts">
  import { app } from '../app.svelte';
  import Button from '../kit/Button.svelte';
  import { kgText } from '../lifter';
  import { showToast } from '../overlays.svelte';
  import {
    cellEdit,
    cellForm,
    cellName,
    cellProblem,
    handHidden,
    recordTable,
    type CellEdit,
    type CellForm,
    type TableCell,
  } from '../recordTable';
  import { routeHash } from '../route';
  import { localDate } from '../session';

  /**
   * The record book as a table: rows are rep counts, columns the four lifts
   * that keep one. A cell is the best there, logged and hand-entered together.
   * A logged value's date opens its session; tapping the weight edits the
   * cell's hand-entered value in a row opened beneath, weight and date, which
   * can also be cleared. Logged values update themselves and are not edited.
   */

  const today = localDate(new Date());
  const table = $derived(recordTable(app.records, app.manualRecords, app.library, today));
  const columnCount = $derived(table.columns.length + 1);

  /** The cell being edited, by its place, so a reload under it does not lose it. */
  let editing = $state<{ exerciseId: string; reps: number } | null>(null);
  let form = $state<CellForm>({ kg: '', date: today });
  let problem = $state<string | null>(null);

  const open = (cell: TableCell) =>
    editing?.exerciseId === cell.exerciseId && editing.reps === cell.reps;

  function edit(cell: TableCell): void {
    if (open(cell)) {
      editing = null;
      return;
    }
    editing = { exerciseId: cell.exerciseId, reps: cell.reps };
    form = cellForm(cell, today);
    problem = null;
  }

  /** The cell under the editor, as it is now. */
  const current = $derived(
    editing
      ? (table.rows
          .find((r) => r.reps === editing!.reps)
          ?.cells.find((c) => c.exerciseId === editing!.exerciseId) ?? null)
      : null,
  );

  const said = (cell: TableCell, kg: string) => `${cellName(cell, table.columns)} · ${kg} kg`;

  /** Applies an edit, and returns what undoes it. */
  async function apply({ put, drop }: CellEdit): Promise<(() => void) | null> {
    const replaced = put
      ? (app.manualRecords.find(
          (r) =>
            r.date === put.date &&
            r.exercise_id === put.exercise_id &&
            r.reps === put.reps &&
            r !== drop,
        ) ?? null)
      : null;
    if (put && !(await app.saveRow('manualRecords', put))) return null;
    if (drop && !(await app.removeRow('manualRecords', drop))) return null;
    return () => {
      void (async () => {
        if (put) await app.removeRow('manualRecords', put);
        if (replaced) await app.saveRow('manualRecords', replaced);
        if (drop) await app.saveRow('manualRecords', drop);
      })();
    };
  }

  async function save(cell: TableCell): Promise<void> {
    problem = cellProblem(form, today);
    if (problem) return;
    const change = cellEdit(cell, form);
    const undo = await apply(change);
    if (!undo) return;
    editing = null;
    showToast({
      message: cell.hand ? 'Record changed' : 'Record saved',
      strong: said(cell, kgText(change.put!.weight_kg)),
      action: { label: 'Undo', run: undo },
    });
  }

  async function clear(cell: TableCell): Promise<void> {
    const undo = await apply(cellEdit(cell, null));
    if (!undo) return;
    editing = null;
    showToast({
      message: 'Hand-entered record cleared',
      strong: said(cell, kgText(cell.hand!.weight_kg)),
      action: { label: 'Undo', run: undo },
    });
  }

  /** What a screen reader hears for a cell. */
  function spoken(cell: TableCell): string {
    const name = cellName(cell, table.columns);
    if (!cell.best) return `${name}, no record. Enter one by hand`;
    const by = cell.best.sessionId ? 'logged' : 'entered by hand';
    return `${name}, ${cell.best.weight} kilograms, ${cell.best.date}, ${by}. Edit the hand-entered value`;
  }
</script>

<section id="records" aria-labelledby="records-h">
  <div class="sec">
    <h2 id="records-h" class="caps">Best at each rep count</h2>
  </div>

  <div class="card wrap">
    <table>
      <thead>
        <tr>
          <th scope="col" class="reps"><span class="visually-hidden">Reps</span></th>
          {#each table.columns as column (column.exerciseId)}
            <th scope="col" class="caps" title={column.name}>
              <abbr title={column.name}>{column.label}</abbr>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each table.rows as row (row.reps)}
          <tr>
            <th scope="row" class="reps figure-num">{row.reps}</th>
            {#each row.cells as cell (cell.exerciseId)}
              <td class:on={open(cell)}>
                <button
                  class="w figure-num"
                  class:hand={cell.best !== null && cell.best.sessionId === null}
                  class:none={cell.best === null}
                  aria-label={spoken(cell)}
                  aria-expanded={open(cell)}
                  onclick={() => edit(cell)}>{cell.best ? cell.best.weight : '–'}</button
                >
                {#if cell.best?.sessionId}
                  <a
                    class="d"
                    href={routeHash({ name: 'session', id: cell.best.sessionId })}
                    aria-label="{cellName(cell, table.columns)}: open the session of {cell.best
                      .date}">{cell.best.date}</a
                  >
                {:else if cell.best}
                  <span class="d">{cell.best.date}</span>
                {/if}
              </td>
            {/each}
          </tr>
          {#if current && editing && editing.reps === row.reps}
            <tr class="editor">
              <td colspan={columnCount}>
                <form
                  onsubmit={(event) => {
                    event.preventDefault();
                    void save(current);
                  }}
                >
                  <p class="what caps">{cellName(current, table.columns)}</p>
                  <div class="fields">
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
                  </div>
                  {#if handHidden(current)}
                    <p class="meta">
                      The {current.best!.weight} kg shown is heavier than this one, which is kept.
                    </p>
                  {:else if current.best && current.best.sessionId && !current.hand}
                    <p class="meta">
                      {current.best.weight} kg is logged. A weight entered here counts if it is heavier.
                    </p>
                  {/if}
                  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
                  <div class="actions">
                    <Button type="submit" variant="quiet">Save</Button>
                    {#if current.hand}
                      <Button variant="link" onclick={() => clear(current)}>Clear</Button>
                    {/if}
                    <Button variant="link" onclick={() => (editing = null)}>Cancel</Button>
                  </div>
                </form>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
  <p class="group-foot">
    Kilograms. Tap a weight to enter or change a record by hand; italics are entered by hand. A date
    opens the session that set it.
  </p>
</section>

<style>
  .sec {
    align-items: center;
  }

  h2 {
    margin: 0;
  }

  .wrap {
    margin: 0 12px;
    padding: 0;
    overflow: hidden;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-variant-numeric: lining-nums tabular-nums;
  }

  th.reps {
    width: 34px;
  }

  thead th {
    padding: var(--space-2) 0;
    border-bottom: var(--hairline) solid var(--line-strong);
    color: var(--ink-2);
    text-align: center;
  }

  abbr {
    text-decoration: none;
    letter-spacing: 0.08em;
  }

  tbody th.reps {
    padding-left: var(--space-1);
    color: var(--muted);
    font-size: var(--fs-meta);
    font-weight: var(--fw-num);
    text-align: center;
  }

  tbody tr + tr > * {
    border-top: var(--hairline) solid var(--line);
  }

  td {
    padding: 0;
    text-align: center;
  }

  td.on {
    background: var(--sunken);
  }

  .w {
    display: block;
    width: 100%;
    min-height: 34px;
    padding: 6px 2px 0;
    font-size: 1.0625rem;
    line-height: 1.1;
    color: var(--ink);
  }

  .w.hand {
    font-style: italic;
  }

  .w.none {
    color: var(--muted);
  }

  .w:active {
    background: var(--sunken);
  }

  .d {
    display: block;
    padding-bottom: 6px;
    font-size: 0.6875rem;
    line-height: 1.2;
    color: var(--ink-2);
    white-space: nowrap;
  }

  a.d {
    min-height: 24px;
    padding-top: 4px;
    margin-top: -4px;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .editor td {
    padding: var(--space-3) var(--space-4) var(--space-3);
    background: var(--sunken);
    text-align: left;
  }

  .editor form {
    display: grid;
    gap: var(--space-3);
  }

  .what {
    color: var(--ink-2);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-4);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .problem {
    font-size: var(--fs-meta);
  }
</style>

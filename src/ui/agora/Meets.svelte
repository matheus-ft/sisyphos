<script lang="ts">
  import type { Meet } from '../../model';
  import { app } from '../app.svelte';
  import Button from '../kit/Button.svelte';
  import EmptyState from '../kit/EmptyState.svelte';
  import Icon from '../kit/Icon.svelte';
  import { kgText, whenText } from '../lifter';
  import {
    LIFT_NAMES,
    blankForm,
    formFrom,
    meetFrom,
    meetProblem,
    meetSaid,
    meetTitle,
    meetTotal,
    meetWhen,
    meetsNewestFirst,
    meetsSummary,
    totalText,
    usualExercises,
    type MeetForm,
  } from '../meets';
  import { confirmDialog, showToast } from '../overlays.svelte';
  import { localDate } from '../session';
  import MeetEditor from './MeetEditor.svelte';

  /**
   * Every meet, newest first, each with its date, name, location and total;
   * above them the all-time meet best of each lift and the most recent meet's.
   * A meet is entered or changed in the editor opened above the list.
   */

  const today = localDate(new Date());

  const rows = $derived(meetsNewestFirst(app.meets));
  const summary = $derived(meetsSummary(app.meets, app.library));
  const usual = $derived(usualExercises(app.meets, app.current, app.library));

  /** The meet being changed, or 'new'; null while the list is all there is. */
  let editing = $state<Meet | 'new' | null>(null);
  let form = $state<MeetForm>(blankForm(today, { squat: '', bench: '', deadlift: '' }));
  let problem = $state<string | null>(null);

  function add(): void {
    form = blankForm(today, usual);
    problem = null;
    editing = 'new';
  }

  function change(meet: Meet): void {
    form = formFrom(meet, usual);
    problem = null;
    editing = meet;
  }

  async function save(): Promise<void> {
    const previous = editing === 'new' ? null : editing;
    problem = meetProblem(form, app.library, today);
    if (problem || editing === null) return;

    const now = new Date().toISOString();
    let identity: Pick<Meet, 'id' | 'created_at' | 'updated_at' | 'device_id'>;
    if (previous) {
      identity = previous;
    } else {
      const id = await app.newMeetId(form.date);
      if (id === null) return;
      identity = {
        id,
        created_at: now,
        updated_at: now,
        device_id: app.storage!.log.options.deviceId,
      };
    }
    const meet = meetFrom(form, identity);
    if (!(await app.saveMeet(meet))) return;
    editing = null;
    showToast({
      message: previous ? 'Meet saved' : 'Meet added',
      strong: meetSaid(meet),
      action: {
        label: 'Undo',
        run: () => void (previous ? app.saveMeet(previous) : app.removeMeet(meet)),
      },
    });
  }

  async function remove(): Promise<void> {
    const meet = editing;
    if (meet === null || meet === 'new') return;
    const ok = await confirmDialog({
      title: `Delete ${meetTitle(meet)}?`,
      body: 'It is deleted from this device and, at the next sync, from the log.',
      confirmLabel: 'Delete meet',
      cancelLabel: 'Keep it',
      danger: true,
    });
    if (!ok || !(await app.removeMeet(meet))) return;
    editing = null;
    showToast({
      message: 'Meet deleted',
      strong: meetSaid(meet),
      action: { label: 'Undo', run: () => void app.saveMeet(meet) },
    });
  }
</script>

<section id="meets" aria-labelledby="meets-h">
  {#if rows.length > 0}
    <p class="sec caps">All-time best</p>
    <div class="card board">
      <table>
        <thead>
          <tr>
            <th scope="col"><span class="visually-hidden">Lift</span></th>
            <th scope="col" class="caps">Best</th>
            <th scope="col" class="caps">Latest</th>
          </tr>
        </thead>
        <tbody>
          {#each summary.lifts as line (line.lift)}
            <tr>
              <th scope="row">{LIFT_NAMES[line.lift]}</th>
              <td>
                {#if line.best}
                  <span class="figure-num kg">{kgText(line.best.kg)}</span>
                  <span class="meta">
                    {[line.best.exercise, whenText(line.best.date, today)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                {:else}
                  <span class="none">–</span>
                {/if}
              </td>
              <td>
                {#if line.latest}
                  <span class="figure-num kg">{kgText(line.latest.kg)}</span>
                  {#if line.latest.exercise}<span class="meta">{line.latest.exercise}</span>{/if}
                {:else}
                  <span class="none">–</span>
                {/if}
              </td>
            </tr>
          {/each}
          <tr class="total">
            <th scope="row">Total</th>
            <td>
              {#if summary.total}
                <span class="figure-num kg">{kgText(summary.total.kg)}</span>
                <span class="meta">{whenText(summary.total.date, today)}</span>
              {:else}
                <span class="none">–</span>
              {/if}
            </td>
            <td>
              {#if summary.latest?.total != null}
                <span class="figure-num kg">{kgText(summary.latest.total)}</span>
              {:else}
                <span class="none">–</span>
              {/if}
            </td>
          </tr>
        </tbody>
      </table>
      {#if summary.latest}
        <p class="meta latest">
          Latest meet: {meetTitle(summary.latest.meet)}, {whenText(summary.latest.meet.date, today)}
        </p>
      {/if}
    </div>
  {/if}

  <div class="sec">
    <h2 id="meets-h" class="caps">Meets</h2>
    {#if editing === null}<Button variant="link" caps onclick={add}>Add a meet</Button>{/if}
  </div>

  {#if editing !== null}
    <MeetEditor
      bind:form
      library={app.library}
      {today}
      {problem}
      ondelete={editing === 'new' ? null : remove}
      onsubmit={save}
      oncancel={() => (editing = null)}
    />
  {/if}

  {#if rows.length === 0}
    {#if editing === null}
      <EmptyState
        title="No meets yet"
        line="A meet you have lifted at goes here with its nine attempts, and its total follows."
      />
    {/if}
  {:else}
    <ul class="group">
      {#each rows as meet (meet.id)}
        <li class="row-link">
          <button
            aria-label="{meetTitle(meet)}, {meetWhen(meet, today)}, total {totalText(
              meetTotal(meet),
            )}. Edit"
            onclick={() => change(meet)}
          >
            <span class="grow">
              <span class="t">{meetTitle(meet)}</span>
              <span class="s">{meetWhen(meet, today)}</span>
            </span>
            <span class="v figure-num total-v">{totalText(meetTotal(meet))}</span>
            <Icon name="chev" size="sm" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if rows.length > 0}
    <p class="group-foot">
      The best of a lift is its heaviest good attempt; the total is the three bests added, and a
      dash while a lift has no good attempt.
    </p>
  {/if}
</section>

<style>
  .sec {
    align-items: center;
  }

  h2 {
    margin: 0;
  }

  .board {
    margin: 0 12px;
    padding: var(--space-2) var(--space-4) var(--space-3);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: lining-nums tabular-nums;
  }

  thead th {
    padding-bottom: var(--space-1);
    color: var(--muted);
    text-align: right;
  }

  tbody th {
    padding: var(--space-2) var(--space-2) var(--space-2) 0;
    font-weight: var(--fw-text);
    text-align: left;
    vertical-align: baseline;
    white-space: nowrap;
  }

  td {
    padding: var(--space-2) 0 var(--space-2) var(--space-2);
    text-align: right;
    vertical-align: baseline;
  }

  td .meta {
    display: block;
    font-size: 0.8125rem;
  }

  tbody tr + tr > * {
    border-top: var(--hairline) solid var(--line);
  }

  .kg {
    font-size: var(--fs-row);
  }

  .none {
    color: var(--muted);
  }

  .total th,
  .total .kg {
    font-weight: var(--fw-strong);
  }

  .latest {
    margin: var(--space-2) 0 0;
  }

  .total-v {
    font-size: var(--fs-row);
  }
</style>

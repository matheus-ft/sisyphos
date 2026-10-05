<script lang="ts">
  import type {
    Exercise,
    ExerciseInstance,
    Id,
    LoadUnit,
    PerformedSet,
    Session,
  } from '../../model';
  import { app } from '../app.svelte';
  import { entryContext, rowTargets } from '../entry';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import Laurel from '../kit/Laurel.svelte';
  import Sheet from '../kit/Sheet.svelte';
  import { confirmDialog } from '../overlays.svelte';
  import {
    addSet,
    amountOf,
    editSet,
    formatSeconds,
    measureOf,
    moveExercise,
    needsBodyweight,
    parseNumber,
    parseRpe,
    parseSeconds,
    planSet,
    removeExercise,
    removeSet,
    setExerciseNotes,
    skipSet,
    unitOf,
    type SetEdit,
  } from '../session';
  import {
    doneSummary,
    lastSummary,
    recordNote,
    targetRpeText,
    upcomingLine,
    warmupsText,
    type CardMode,
  } from './cards';
  import { applySuggestion, sessionsBefore, suggestionShows } from './flow';
  import { setLabel } from './panel';
  import { addWarmups, warmupPlan } from './warmups';

  /**
   * One exercise of a session, in the state the lifter's place in the session
   * gives it: done (a summary with a seal), current (expanded, holding the set
   * being entered) or upcoming (one line). A tap opens a collapsed one. Its
   * sets are rows typed into as in v0, each with an end button that opens the
   * entry panel.
   */
  interface Props {
    session: Session;
    instance: ExerciseInstance;
    /** Missing when the log names an exercise this library does not have. */
    exercise: Exercise | undefined;
    mode: CardMode;
    /** The last other session's visit to this exercise. */
    last: ExerciseInstance | null;
    /** The unit the lifter picked for this exercise in this session, which its empty rows take. */
    chosenUnit: LoadUnit | null;
    /** The set being entered in the whole session, drawn inverted; at most one. */
    active: Id | null;
    /** The sets that were records when lifted: the laurel and the gilded wash. */
    records: ReadonlySet<Id>;
    /** The lifter hid this exercise's suggested warm-ups for the session. */
    warmupsHidden: boolean;
    onchange: (next: Session) => void;
    onhidewarmups: () => void;
    /** Opens the exercise's history. */
    onhistory: (exercise: Exercise) => void;
    /** Opens the entry panel on a set. */
    onentry: (set: PerformedSet) => void;
    /** A unit picked on one of the rows: the owner keeps it for the exercise's rows to come. */
    onunit: (unit: LoadUnit) => void;
  }
  let {
    session,
    instance,
    exercise,
    mode,
    last,
    chosenUnit,
    active,
    records,
    warmupsHidden,
    onchange,
    onhidewarmups,
    onhistory,
    onentry,
    onunit,
  }: Props = $props();

  const timed = $derived(exercise ? measureOf(exercise) === 'time' : false);
  const measure = $derived(timed ? 'time' : 'weight');
  const missingBodyweight = $derived(exercise ? needsBodyweight(session, exercise) : false);
  const UNITS: LoadUnit[] = ['kg', 'lb', 'pins'];
  const position = $derived(session.exercises.findIndex((e) => e.id === instance.id));
  const name = $derived(exercise?.name ?? instance.exercise_id);

  /** A card the lifter opened by tapping; the current one is always open. */
  let tapped = $state(false);
  const expanded = $derived(mode === 'current' || tapped);
  // A card that changes place (it became current, then done) starts again from its own default.
  $effect(() => {
    void mode;
    tapped = false;
  });

  /** The set whose actions (warm-up, skip, remove) are open, from a tap on its number. */
  let opened = $state<Id | null>(null);
  let noting = $state(false);
  let menu = $state(false);

  // --- what the sets are offered ---------------------------------------------------

  const earlier = $derived(sessionsBefore(app.sessions, session.date));
  const contexts = $derived(
    new Map(
      instance.performed
        .filter((s) => s.state !== 'done')
        .map((s) => [
          s.id,
          entryContext({
            session,
            instance,
            set: s,
            exercise,
            sessions: earlier,
            oneRms: app.oneRms,
            prefs: app.prefs,
            chosen: chosenUnit,
          }),
        ]),
    ),
  );
  const firstWorking = $derived(
    instance.performed.find((s) => !s.is_warmup && s.state === 'pending') ?? null,
  );
  const lead = $derived(firstWorking ? (contexts.get(firstWorking.id) ?? null) : null);
  const suggestion = $derived(mode === 'current' && lead ? lead.suggestion : null);
  const chip = $derived(suggestionShows(instance, suggestion) ? suggestion : null);
  const plan = $derived(
    mode === 'current' && lead && !warmupsHidden
      ? warmupPlan({ instance, exercise, ctx: lead })
      : null,
  );

  const summary = $derived(doneSummary(instance, exercise, records));
  const lastText = $derived(lastSummary(last, exercise));
  const targetRpe = $derived(targetRpeText(instance));

  /** Numbers rows show for each set: working sets count from 1, warm-ups wear "W". */
  const numbers = $derived.by(() => {
    let n = 0;
    return new Map(instance.performed.map((s) => [s.id, s.is_warmup ? 'W' : String(++n)]));
  });

  // --- editing ---------------------------------------------------------------------

  /** A session not started yet is being planned: what is typed is to be lifted, so nothing is done. */
  const planning = $derived(session.started_at === null);

  /** The unit a row shows and is typed in: its own, else the entry panel's for that set (`unitFor`). */
  const unitOfRow = (set: PerformedSet): LoadUnit =>
    unitOf(set) ?? contexts.get(set.id)?.unit ?? 'kg';

  function edit(set: PerformedSet, change: SetEdit): void {
    const apply = planning ? planSet : editSet;
    onchange(apply(session, instance.id, set.id, change, measure, unitOfRow(set)));
  }

  /** A field that does not hold a valid number is put back as it was. */
  function field(
    input: HTMLInputElement,
    parse: (text: string) => number | null | undefined,
    apply: (value: number | null) => SetEdit,
    set: PerformedSet,
    shown: string,
  ): void {
    const value = parse(input.value);
    if (value === undefined) input.value = shown;
    else edit(set, apply(value));
  }

  /**
   * Tapping an empty field that has a target takes the target, selected so that
   * typing replaces it: lifting what was planned costs no typing. Never the RPE,
   * which is what the set felt like, not what was planned.
   */
  function takeTarget(
    input: HTMLInputElement,
    target: string,
    parse: (text: string) => number | null | undefined,
    apply: (value: number) => SetEdit,
    set: PerformedSet,
  ): void {
    // A skipped set shows its target struck through; typing into it is not lifting it.
    if (set.state !== 'pending' || input.value !== '' || target === '') return;
    const value = parse(target);
    if (value === null || value === undefined) return;
    edit(set, apply(value));
    input.value = target;
    requestAnimationFrame(() => input.select());
  }

  /**
   * The unit button: the pick is kept for the exercise's rows to come, and so
   * for an empty row, which has no load to hold it; a row with a number takes
   * the unit at once.
   */
  function switchUnit(set: PerformedSet): void {
    const next = UNITS[(UNITS.indexOf(unitOfRow(set)) + 1) % UNITS.length];
    onunit(next);
    if (amountOf(set) !== null) edit(set, { unit: next });
  }

  function shownAmount(set: PerformedSet): string {
    const amount = amountOf(set);
    if (amount === null) return '';
    return timed ? formatSeconds(amount).replace(' s', '') : String(amount);
  }

  const targetsFor = (set: PerformedSet) => {
    const ctx = contexts.get(set.id);
    return ctx ? rowTargets(instance, set, ctx, timed) : { amount: '', reps: '', rpe: '' };
  };

  async function removeAsked(): Promise<void> {
    menu = false;
    const logged = instance.performed.filter((s) => s.state === 'done').length;
    const ok =
      logged === 0 ||
      (await confirmDialog({
        title: `Remove ${name}?`,
        body: `Its ${logged} done ${logged === 1 ? 'set goes' : 'sets go'} with it.`,
        confirmLabel: `Remove ${name}`,
        cancelLabel: 'Keep it',
        danger: true,
      }));
    if (ok) onchange(removeExercise(session, instance.id));
  }

  function move(by: -1 | 1): void {
    menu = false;
    onchange(moveExercise(session, instance.id, by));
  }

  const newId = () => crypto.randomUUID();
</script>

<section
  class="card ex"
  class:card-current={mode === 'current'}
  class:card-done={mode === 'done'}
  class:upcoming={mode === 'upcoming'}
  aria-label={name}
>
  {#if !expanded}
    <button class="fold" aria-expanded="false" onclick={() => (tapped = true)}>
      <span class="head">
        <h3 class="name">{name}</h3>
        {#if mode === 'done'}
          <span class="seal" aria-label="Done"><Icon name="check" size={14} stroke={2.6} /></span>
        {:else}
          <Icon name="down" size="sm" />
        {/if}
      </span>
      {#if mode === 'done'}
        <span class="line figure">
          {#each summary.sets as s, i (i)}
            {#if i > 0}<span class="sep">&nbsp;·&nbsp;</span>{/if}<span class:rec={s.record}
              >{s.text}</span
            >
          {:else}
            <span class="meta">No sets done</span>
          {/each}
        </span>
        {#if warmupsText(summary.warmups) || recordNote(summary.recordReps)}
          <span class="foot-line">
            <span class="meta">{warmupsText(summary.warmups) ?? ''}</span>
            {#if recordNote(summary.recordReps)}
              <span class="meta note-record"><Laurel />{recordNote(summary.recordReps)}</span>
            {/if}
          </span>
        {/if}
      {:else}
        <span class="meta">{upcomingLine(instance, lastText)}</span>
      {/if}
    </button>
  {:else}
    <header class="head">
      <h3 class="name">{name}</h3>
      <span class="tools">
        {#if mode !== 'current'}
          <button
            class="icon-btn flip"
            aria-label="Collapse {name}"
            aria-expanded="true"
            onclick={() => (tapped = false)}><Icon name="down" size="sm" /></button
          >
        {/if}
        <button class="icon-btn" aria-label="More for {name}" onclick={() => (menu = true)}
          ><Icon name="more" /></button
        >
      </span>
    </header>
    {#if lastText}
      <p class="meta last">
        Last time <b>{lastText}</b>{#if targetRpe}, target {targetRpe}{/if}
      </p>
    {:else if targetRpe}
      <p class="meta last">Target {targetRpe}</p>
    {/if}
    {#if noting || instance.notes}
      <input
        class="note"
        aria-label="Note on {name}"
        placeholder="Note…"
        value={instance.notes ?? ''}
        onchange={(e) => onchange(setExerciseNotes(session, instance.id, e.currentTarget.value))}
      />
    {/if}

    {#if chip}
      <div class="suggest">
        <button
          class="sugg-chip"
          aria-label="Use {chip.load} {chip.unit} for the sets still to do"
          onclick={() => onchange(applySuggestion(session, instance.id, chip))}
        >
          <Icon name={chip.delta > 0 ? 'up' : 'same'} size="sm" stroke={2.4} />
          <span class="figure-num">{chip.load} {chip.unit}</span>
        </button>
        <span class="meta">{chip.reason}</span>
      </div>
    {/if}

    {#if plan}
      <div class="ladder">
        <div class="ladder-head">
          <span class="meta">Suggested warm-ups</span>
          <span class="ladder-actions">
            <Button
              variant="link"
              caps
              onclick={() => onchange(addWarmups(session, instance.id, plan, plan.rungs, newId))}
              >Add all</Button
            >
            <Button variant="link" caps onclick={onhidewarmups}>Hide</Button>
          </span>
        </div>
        {#each plan.rungs as rung (rung.load)}
          <div class="row ghost">
            <span class="n">w</span>
            <span class="ghost-fig figure-num">{rung.load} × {rung.reps}</span>
            <button
              class="add"
              aria-label="Add warm-up {rung.load} {plan.unit} for {rung.reps}"
              onclick={() => onchange(addWarmups(session, instance.id, plan, [rung], newId))}
              ><Icon name="plus" size="sm" stroke={2.4} />Add</button
            >
          </div>
        {/each}
      </div>
    {/if}

    <div class="rows">
      {#each instance.performed as set (set.id)}
        {@const target = targetsFor(set)}
        {@const skipped = set.state === 'skipped'}
        {@const isActive = set.id === active && set.state === 'pending'}
        {@const isRecord = records.has(set.id) && set.state === 'done' && !set.is_warmup}
        {@const label = setLabel(instance, set)}
        <div
          class="row"
          class:timed
          class:skipped
          class:warm={set.is_warmup}
          class:pending={set.state === 'pending' && !isActive}
          class:done={set.state === 'done'}
          class:active={isActive}
          class:record={isRecord}
        >
          <button
            class="n"
            aria-label="{label} actions"
            onclick={() => (opened = opened === set.id ? null : set.id)}
            >{numbers.get(set.id)}</button
          >
          <input
            inputmode={timed ? 'text' : 'decimal'}
            aria-label={timed ? 'Time' : 'Load'}
            placeholder={target.amount || (timed ? '0:00' : '')}
            value={shownAmount(set)}
            onfocus={(e) =>
              takeTarget(
                e.currentTarget,
                target.amount,
                timed ? parseSeconds : parseNumber,
                (amount) => ({ amount }),
                set,
              )}
            onchange={(e) =>
              field(
                e.currentTarget,
                timed ? parseSeconds : parseNumber,
                (amount) => ({ amount }),
                set,
                shownAmount(set),
              )}
          />
          {#if !timed}
            <button class="unit" aria-label="Unit, {unitOfRow(set)}" onclick={() => switchUnit(set)}
              >{unitOfRow(set)}</button
            >
            <span class="x">×</span>
            <input
              inputmode="numeric"
              aria-label="Reps"
              placeholder={target.reps}
              value={set.reps ?? ''}
              onfocus={(e) =>
                takeTarget(e.currentTarget, target.reps, parseNumber, (reps) => ({ reps }), set)}
              onchange={(e) =>
                field(
                  e.currentTarget,
                  parseNumber,
                  (reps) => ({ reps }),
                  set,
                  String(set.reps ?? ''),
                )}
            />
          {/if}
          <!-- A set skipped before it had an RPE has none to strike through. -->
          {#if !set.is_warmup && !(skipped && set.rpe === null)}
            <span class="x">@</span>
            <input
              inputmode="decimal"
              aria-label="RPE"
              disabled={planning}
              placeholder={isActive ? '—' : target.rpe || '—'}
              value={set.rpe ?? ''}
              onchange={(e) =>
                field(e.currentTarget, parseRpe, (rpe) => ({ rpe }), set, String(set.rpe ?? ''))}
            />
          {/if}
          <span class="st">
            {#if set.state === 'done'}
              <button
                class="status"
                aria-label="Edit {label.toLowerCase()}"
                onclick={() => onentry(set)}
              >
                {#if isRecord}
                  <Laurel /><span class="word record-word">record</span>
                {:else}
                  {#if set.is_warmup}<span class="word">warm-up</span>{/if}
                  <Icon name="check" size={18} stroke={2.4} />
                {/if}
              </button>
            {:else if skipped}
              <button
                class="status"
                aria-label="Enter {label.toLowerCase()}"
                onclick={() => onentry(set)}><span class="word">skipped</span></button
              >
            {:else}
              <button
                class="status open"
                aria-label="Enter {label.toLowerCase()}"
                onclick={() => onentry(set)}><Icon name="sheet" /></button
              >
            {/if}
          </span>
        </div>
        {#if opened === set.id}
          <div class="actions">
            <Button variant="link" onclick={() => edit(set, { is_warmup: !set.is_warmup })}>
              {set.is_warmup ? 'Not a warm-up' : 'Warm-up'}
            </Button>
            <Button
              variant="link"
              onclick={() => onchange(skipSet(session, instance.id, set.id, !skipped))}
            >
              {skipped ? 'Not skipped' : 'Skip'}
            </Button>
            <Button
              variant="link"
              onclick={() => onchange(removeSet(session, instance.id, set.id))}
            >
              Remove set
            </Button>
          </div>
        {/if}
      {/each}
    </div>

    {#if missingBodyweight}<p class="meta">Today's bodyweight, below, counts in these sets.</p>{/if}
    <div class="foot">
      <Button variant="link" onclick={() => onchange(addSet(session, instance.id, newId))}
        >+ Set</Button
      >
      <Button variant="link" onclick={() => (noting = !noting)}>Note</Button>
    </div>
  {/if}
</section>

<Sheet open={menu} onclose={() => (menu = false)} label="{name}, options">
  <p class="caps menu-title">{name}</p>
  <ul class="group menu">
    <li class="row-link">
      <button disabled={position === 0} onclick={() => move(-1)}
        ><span class="grow t">Move up</span><Icon name="up" size="sm" /></button
      >
    </li>
    <li class="row-link">
      <button disabled={position === session.exercises.length - 1} onclick={() => move(1)}
        ><span class="grow t">Move down</span><span class="flip"><Icon name="up" size="sm" /></span
        ></button
      >
    </li>
    <li class="row-link">
      <button
        onclick={() => {
          menu = false;
          noting = true;
          tapped = true;
        }}
        ><span class="grow t">{instance.notes ? 'Edit note' : 'Add a note'}</span><Icon
          name="edit"
          size="sm"
        /></button
      >
    </li>
    {#if exercise}
      <li class="row-link">
        <button
          onclick={() => {
            menu = false;
            onhistory(exercise);
          }}><span class="grow t">History of {name}</span><Icon name="chev" size="sm" /></button
        >
      </li>
    {/if}
    <li class="row-link">
      <button class="destroy" onclick={removeAsked}
        ><span class="grow t">Remove {name}</span><Icon name="close" size="sm" /></button
      >
    </li>
  </ul>
</Sheet>

<style>
  .ex {
    margin: 0 12px var(--space-2);
    padding: var(--space-3) 14px var(--space-1);
  }

  /* An exercise still to come: no shadow and no fill, a dashed edge: it is a promise, not yet a card. */
  .upcoming {
    background: transparent;
    border: var(--hairline) dashed var(--line-strong);
    box-shadow: none;
    color: var(--ink-2);
  }

  /* A collapsed card is one big button: the tap opens it. */
  .fold {
    display: grid;
    gap: var(--space-1);
    width: 100%;
    min-height: var(--tap);
    padding: 0 0 var(--space-2);
    text-align: left;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: var(--tap);
  }

  .fold .head {
    min-height: 32px;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .upcoming .name {
    color: var(--ink-2);
  }

  .tools {
    display: flex;
    margin: -4px -10px -4px 0;
    color: var(--ink-2);
  }

  .tools .icon-btn {
    color: inherit;
  }

  .seal {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: var(--stroke) solid var(--success);
    border-radius: var(--radius-pill);
    background: var(--success-wash);
    color: var(--success);
  }

  .line {
    overflow: hidden;
    font: var(--fw-medium) 1.0625rem / var(--lh-snug) var(--font-num);
    color: var(--ink);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sep {
    color: var(--muted);
  }

  .rec {
    text-decoration: underline;
    text-decoration-color: var(--laurel-fill);
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
  }

  .foot-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .note-record {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--laurel);
  }

  .last {
    margin: 0;
  }

  .last b {
    font: var(--fw-strong) 1rem var(--font-num);
    font-style: normal;
    color: var(--ink);
  }

  .note {
    width: 100%;
    font-size: var(--fs-meta);
    color: var(--ink-2);
  }

  .suggest {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .sugg-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: var(--stroke) solid var(--accent);
    border-radius: var(--radius-pill);
    background: var(--accent-wash);
    color: var(--accent);
    font-size: 1.0625rem;
  }

  .suggest .meta {
    min-width: 0;
    flex: 1 1 8rem;
  }

  .ladder {
    margin-top: var(--space-2);
  }

  .ladder-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--tap);
  }

  /* Link buttons pad their words; the end ones lean out so the words meet the card's edges. */
  .ladder-actions {
    display: flex;
    gap: var(--space-1);
    margin-right: calc(-1 * var(--space-2));
  }

  .rows {
    display: grid;
    gap: 2px;
    margin-top: var(--space-2);
  }

  /*
   * Every row has the same columns, the status one fixed, so a stack of rows
   * reads as a table: a "record" or "warm-up" at the end never pushes its own
   * row's figures out of line with the rows around it.
   */
  .row {
    display: grid;
    grid-template-columns:
      26px minmax(0, 1fr) 30px 12px minmax(0, 0.7fr) 14px minmax(0, 0.7fr)
      60px;
    align-items: center;
    gap: 2px;
    min-height: var(--tap);
    padding: 0 0 0 2px;
    border-radius: var(--radius-sm);
  }

  .row.timed {
    grid-template-columns: 26px minmax(0, 1fr) 14px minmax(0, 0.7fr) 60px;
  }

  .row input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border-bottom-color: transparent;
    font: var(--fw-medium) var(--fs-row) / 1 var(--font-num);
    text-align: center;
  }

  .row input::placeholder {
    color: var(--muted);
    opacity: 1;
  }

  .row input:focus {
    border-bottom: var(--stroke-strong) solid var(--accent);
  }

  .n {
    min-height: var(--tap);
    font: var(--fw-strong) 0.9375rem / 1 var(--font-num);
    color: var(--ink);
  }

  .x {
    text-align: center;
    color: var(--muted);
    font-size: 0.85em;
  }

  .unit {
    min-height: var(--tap);
    font: var(--fw-strong) var(--fs-label) / 1 var(--font-display);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* Always the last column, even in a row that has no RPE cells before it. */
  .st {
    display: flex;
    grid-column: -2;
    align-items: center;
    justify-content: flex-end;
  }

  .status {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: var(--tap);
    min-height: var(--tap);
    color: var(--success);
  }

  .word {
    font: italic 0.9375rem / 1 var(--font-text);
    color: var(--muted);
  }

  .open {
    color: var(--ink-2);
  }

  /* A warm-up is quiet: smaller figures, "W" in the display face, and no RPE to ask for. */
  .warm input {
    font-size: 1.0625rem;
    color: var(--ink-2);
  }

  .warm .n {
    font-family: var(--font-display);
    font-size: var(--fs-label);
    color: var(--muted);
  }

  .warm .status {
    color: var(--muted);
  }

  /* No RPE cells in a warm-up row: its status takes their place, and its figures stay in line. */
  .row.warm:not(.timed) .st {
    grid-column: 6 / -1;
  }

  .row.warm.timed .st {
    grid-column: 3 / -1;
  }

  .row.pending {
    outline: var(--stroke) dashed var(--line-strong);
    outline-offset: -1.5px;
  }

  .row.done .x {
    color: var(--muted);
  }

  .row.done input[aria-label='RPE'] {
    color: var(--ink-2);
  }

  /* A skipped set was planned and deliberately not done: it stays, struck through. */
  .skipped input,
  .skipped input::placeholder,
  .skipped .n,
  .skipped .x {
    text-decoration: line-through;
    color: var(--muted);
  }

  /*
   * A record set: the gilded wash, and its load and reps underlined in gilt. The
   * wash reaches past the row's edges and the padding takes it back, so the
   * figures stay in their columns and the word at the end has room inside it.
   */
  .record {
    margin-inline: -6px;
    padding-inline: 8px 6px;
    background: var(--laurel-wash);
  }

  .record input[aria-label='Load'],
  .record input[aria-label='Reps'] {
    border-bottom: var(--stroke-strong) solid var(--laurel-fill);
  }

  .record .status {
    color: var(--laurel);
  }

  .record-word {
    color: var(--laurel);
  }

  /* The set being entered: the one inversion in the list, ringed in the accent. */
  .active {
    min-height: 54px;
    margin: 2px -6px;
    padding-inline: 8px 6px;
    outline: none;
    background: var(--figure);
    color: var(--on-figure);
    box-shadow:
      0 0 0 3px var(--surface),
      0 0 0 4.5px var(--accent);
  }

  .active input,
  .active .n {
    color: var(--on-figure);
  }

  .active input {
    font-size: var(--fs-row-active);
    font-weight: var(--fw-num);
  }

  /* A target not yet lifted reads as figures, a little dimmed; only the empty RPE is the accent's dash. */
  .active input::placeholder {
    color: color-mix(in srgb, var(--on-figure) 80%, transparent);
  }

  .active input[aria-label='RPE']::placeholder {
    color: var(--figure-accent);
  }

  .active input:focus {
    border-bottom-color: var(--figure-accent);
  }

  .active .n {
    font-size: 1.125rem;
    font-weight: var(--fw-display);
    color: var(--figure-accent);
  }

  .active .x,
  .active .unit {
    color: var(--on-figure);
    opacity: 0.7;
  }

  .active .open {
    color: var(--figure-accent);
  }

  /* A suggested warm-up: only a suggestion, so no box, italic and muted. */
  .ghost {
    grid-template-columns: 26px minmax(0, 1fr) auto;
    font-style: italic;
    color: var(--muted);
  }

  .ghost .n {
    display: block;
    min-height: 0;
    text-align: center;
    font: italic var(--fw-text) 0.9375rem / 1 var(--font-text);
    color: var(--muted);
  }

  .ghost-fig {
    font-size: 1.0625rem;
    font-weight: var(--fw-medium);
    text-align: center;
    color: var(--muted);
  }

  .add {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-height: var(--tap);
    margin-right: calc(-1 * var(--space-2));
    padding: 0 var(--space-2);
    color: var(--accent);
    font: var(--fw-display) var(--fs-label) / 1 var(--font-display);
    font-style: normal;
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
  }

  /* Under the set's figures, the words starting where its load does; a narrow phone wraps them whole. */
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-1);
    padding-left: calc(26px - var(--space-2));
  }

  .actions :global(.button-link) {
    white-space: nowrap;
  }

  .foot {
    display: flex;
    gap: var(--space-3);
    margin-left: calc(-1 * var(--space-2));
  }

  /*
   * The glyphs turned over: the fold's chevron closes a card it opened, and the
   * arrow that moves up moves down, so neither reads as the other.
   */
  .flip :global(svg) {
    transform: rotate(180deg);
  }

  span.flip {
    display: inline-flex;
  }

  .menu-title {
    margin: 0 0 var(--space-2);
    color: var(--ink-2);
  }

  .menu {
    margin: 0;
  }

  .menu button:disabled {
    opacity: 0.4;
  }

  .menu .destroy {
    color: var(--danger);
  }
</style>

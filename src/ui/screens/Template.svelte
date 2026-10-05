<script lang="ts">
  import type { Template } from '../../model';
  import AddExercise from '../AddExercise.svelte';
  import { app } from '../app.svelte';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import { confirmDialog } from '../overlays.svelte';
  import { formatSeconds, measureOf, parseNumber, parseRpe, parseSeconds } from '../session';
  import {
    addTarget,
    addTemplateExercise,
    editTarget,
    moveTemplateExercise,
    removeTarget,
    removeTemplateExercise,
    rename,
    targetAmount,
    type Target,
    type TargetEdit,
  } from '../template';

  /** A template being edited: its name, its exercises and their targets. Saved as it changes. */
  interface Props {
    template: Template;
  }
  let { template }: Props = $props();

  const onchange = (next: Template) => void app.saveTemplate(next);
  const byId = $derived(new Map(app.library.map((e) => [e.id, e])));
  const measureAt = (index: number) => {
    const exercise = byId.get(template.exercises[index].exercise_id);
    return exercise ? measureOf(exercise) : 'weight';
  };

  function edit(index: number, target: number, change: TargetEdit): void {
    onchange(editTarget(template, index, target, change, measureAt(index)));
  }

  /** A field that does not hold a valid number is put back as it was. */
  function field(
    input: HTMLInputElement,
    parse: (text: string) => number | null | undefined,
    apply: (value: number | null) => TargetEdit,
    index: number,
    target: number,
    shown: string,
  ): void {
    const value = parse(input.value);
    if (value === undefined) input.value = shown;
    else edit(index, target, apply(value));
  }

  function shownAmount(target: Target, timed: boolean): string {
    const amount = targetAmount(target);
    if (amount === null) return '';
    return timed ? formatSeconds(amount).replace(' s', '') : String(amount);
  }

  const low = (interval: [number | null, number | null] | null) => String(interval?.[0] ?? '');

  function renameTo(text: string): void {
    if (text.trim()) onchange(rename(template, text.trim()));
  }

  async function removeExercise(index: number): Promise<void> {
    const name = byId.get(template.exercises[index].exercise_id)?.name ?? 'this exercise';
    const ok = await confirmDialog({
      title: `Remove ${name} from the template?`,
      body: 'Its targets go with it. Sessions already started keep theirs.',
      confirmLabel: `Remove ${name}`,
      cancelLabel: 'Keep it',
      danger: true,
    });
    if (ok) onchange(removeTemplateExercise(template, index));
  }
</script>

<header class="top">
  <button class="icon-btn" aria-label="Back" onclick={() => app.back({ name: 'train' })}
    ><Icon name="back" /></button
  >
  <input
    class="name"
    aria-label="Template name"
    value={template.name}
    onchange={(e) => renameTo(e.currentTarget.value)}
  />
</header>

{#each template.exercises as entry, index (index)}
  {@const exercise = byId.get(entry.exercise_id)}
  {@const timed = measureAt(index) === 'time'}
  <section class="card">
    <header class="ex">
      <h3>{exercise?.name ?? entry.exercise_id}</h3>
      <div class="order">
        <button
          class="icon-btn"
          aria-label="Move up"
          disabled={index === 0}
          onclick={() => onchange(moveTemplateExercise(template, index, -1))}
          ><Icon name="up" size="sm" /></button
        >
        <button
          class="icon-btn down"
          aria-label="Move down"
          disabled={index === template.exercises.length - 1}
          onclick={() => onchange(moveTemplateExercise(template, index, 1))}
          ><Icon name="up" size="sm" /></button
        >
        <button
          class="icon-btn"
          aria-label="Remove {exercise?.name ?? 'exercise'}"
          onclick={() => removeExercise(index)}><Icon name="close" size="sm" /></button
        >
      </div>
    </header>
    {#each entry.prescribed as target, t (t)}
      <div class="row" class:timed>
        <button
          class="n"
          aria-label="Remove target {t + 1}"
          onclick={() => onchange(removeTarget(template, index, t))}>{t + 1}</button
        >
        <input
          inputmode={timed ? 'text' : 'decimal'}
          aria-label={timed ? 'Time' : 'Load'}
          placeholder={timed ? '0:00' : 'by feel'}
          value={shownAmount(target, timed)}
          onchange={(e) =>
            field(
              e.currentTarget,
              timed ? parseSeconds : parseNumber,
              (amount) => ({ amount }),
              index,
              t,
              shownAmount(target, timed),
            )}
        />
        {#if !timed}
          <span class="unit">kg</span>
          <span class="x">×</span>
          <input
            inputmode="numeric"
            aria-label="Reps"
            value={low(target.reps)}
            onchange={(e) =>
              field(e.currentTarget, parseNumber, (reps) => ({ reps }), index, t, low(target.reps))}
          />
        {/if}
        <span class="x">@</span>
        <input
          inputmode="decimal"
          aria-label="RPE"
          value={low(target.rpe)}
          onchange={(e) =>
            field(e.currentTarget, parseRpe, (rpe) => ({ rpe }), index, t, low(target.rpe))}
        />
      </div>
    {/each}
    <Button
      variant="link"
      onclick={() => onchange(addTarget(template, index, timed ? 'time' : 'weight'))}>+ Set</Button
    >
  </section>
{/each}

<div class="add">
  <AddExercise
    library={app.library}
    recentIds={[]}
    onpick={(exercise) => onchange(addTemplateExercise(template, exercise))}
    oncreate={app.startCreating}
  />
</div>

<p class="group-foot">Tap a set's number to remove it. Changes are saved as you go.</p>

<div class="acts">
  <Button variant="primary" bench full onclick={() => app.create(template)}
    >Start a session from it</Button
  >
  <Button variant="quiet" full onclick={() => app.create(template, { planned: true })}
    >Plan one from it</Button
  >
  <Button variant="link" class="danger" onclick={app.deleteTemplate}>Delete template</Button>
</div>

<style>
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-5) var(--gutter) var(--space-3) var(--space-1);
  }

  .name {
    flex: 1;
    min-width: 0;
    border-bottom-color: transparent;
    font: var(--fw-display) var(--fs-title) / var(--lh-snug) var(--font-display);
    letter-spacing: var(--ls-display);
  }

  .card {
    margin: 0 12px var(--space-2);
  }

  .ex {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .order {
    display: flex;
    margin-right: -10px;
    color: var(--ink-2);
  }

  .order .icon-btn {
    color: inherit;
  }

  .order .icon-btn:disabled {
    visibility: hidden;
  }

  .down :global(svg) {
    transform: rotate(180deg);
  }

  .row {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) 30px 14px minmax(0, 1fr) 14px minmax(0, 1fr);
    align-items: center;
    gap: 4px;
  }

  .row.timed {
    grid-template-columns: 30px minmax(0, 1fr) 14px minmax(0, 1fr);
  }

  .row input {
    width: 100%;
    min-width: 0;
    font: var(--fw-medium) var(--fs-row) / 1 var(--font-num);
    text-align: center;
  }

  .n {
    font: var(--fw-strong) 0.9375rem / 1 var(--font-num);
    color: var(--ink-2);
  }

  .x,
  .unit {
    text-align: center;
    color: var(--muted);
  }

  .unit {
    font: var(--fw-strong) var(--fs-label) / 1 var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
  }

  .add {
    margin: var(--space-3) 12px 0;
  }

  .acts {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-5) 12px 0;
  }

  .acts :global(.danger) {
    justify-self: center;
    color: var(--danger);
  }
</style>

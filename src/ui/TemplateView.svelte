<script lang="ts">
  import type { Exercise, Template } from '../model';
  import AddExercise from './AddExercise.svelte';
  import { formatSeconds, measureOf, parseNumber, parseRpe, parseSeconds } from './session';
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
  } from './template';

  interface Props {
    template: Template;
    library: Exercise[];
    onchange: (next: Template) => void;
    onstart: () => void;
    onclose: () => void;
    ondelete: () => void;
  }
  let { template, library, onchange, onstart, onclose, ondelete }: Props = $props();

  const byId = $derived(new Map(library.map((e) => [e.id, e])));
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

  function removeExercise(index: number): void {
    const name = byId.get(template.exercises[index].exercise_id)?.name ?? 'this exercise';
    if (confirm(`Remove ${name} from the template?`))
      onchange(removeTemplateExercise(template, index));
  }
</script>

<article>
  <button class="link" onclick={onclose}>‹ back</button>
  <input
    class="name"
    aria-label="Template name"
    value={template.name}
    onchange={(e) => renameTo(e.currentTarget.value)}
  />

  {#each template.exercises as entry, index (index)}
    {@const exercise = byId.get(entry.exercise_id)}
    {@const timed = measureAt(index) === 'time'}
    <section>
      <header>
        <h2>{exercise?.name ?? entry.exercise_id}</h2>
        <div class="order">
          <button
            class="quiet"
            aria-label="Move up"
            disabled={index === 0}
            onclick={() => onchange(moveTemplateExercise(template, index, -1))}>↑</button
          >
          <button
            class="quiet"
            aria-label="Move down"
            disabled={index === template.exercises.length - 1}
            onclick={() => onchange(moveTemplateExercise(template, index, 1))}>↓</button
          >
          <button class="quiet" onclick={() => removeExercise(index)}>remove</button>
        </div>
      </header>
      {#each entry.prescribed as target, t (t)}
        <div class="row tabular" class:timed>
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
            <span class="sep">×</span>
            <input
              inputmode="numeric"
              aria-label="Reps"
              value={low(target.reps)}
              onchange={(e) =>
                field(
                  e.currentTarget,
                  parseNumber,
                  (reps) => ({ reps }),
                  index,
                  t,
                  low(target.reps),
                )}
            />
          {/if}
          <span class="sep">@</span>
          <input
            inputmode="decimal"
            aria-label="RPE"
            value={low(target.rpe)}
            onchange={(e) =>
              field(e.currentTarget, parseRpe, (rpe) => ({ rpe }), index, t, low(target.rpe))}
          />
        </div>
      {/each}
      <button
        class="link"
        onclick={() => onchange(addTarget(template, index, timed ? 'time' : 'weight'))}
        >+ set</button
      >
    </section>
  {/each}

  <AddExercise
    {library}
    recentIds={[]}
    onpick={(exercise) => onchange(addTemplateExercise(template, exercise))}
  />

  <p class="hint">Tap a set's number to remove it. Changes are saved as you go.</p>

  <button class="start" onclick={onstart}>Start a session from it</button>
  <button class="link" onclick={ondelete}>delete template</button>
</article>

<style>
  .name {
    display: block;
    width: 100%;
    border-bottom-color: transparent;
    font-size: 1.4rem;
    font-weight: 600;
  }

  section {
    padding: 1rem 0 0.5rem;
    border-bottom: 1px solid var(--line);
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .quiet {
    min-height: 0;
    font-size: 0.85rem;
    color: var(--muted);
  }

  /* Up, down and remove sit together at the right of the exercise's name. */
  .order {
    display: flex;
    gap: 0.25rem;
  }

  .order button {
    min-width: 2.25rem;
  }

  .order button:disabled {
    visibility: hidden;
  }

  .row {
    display: grid;
    grid-template-columns: 2rem 1fr 2.75rem 1rem 1fr 1rem 1fr;
    align-items: center;
    gap: 0.25rem;
  }

  .row.timed {
    grid-template-columns: 2rem 1fr 1rem 1fr;
  }

  .row input {
    width: 100%;
    min-width: 0;
    font-size: 1.2rem;
    text-align: center;
  }

  .n,
  .sep {
    color: var(--muted);
    text-align: center;
  }

  .unit {
    font-size: 0.85rem;
    color: var(--ink-2);
    text-align: center;
  }

  .hint {
    font-size: 0.85rem;
    color: var(--muted);
  }

  .start {
    display: block;
    width: 100%;
    margin: 1.5rem 0 0.5rem;
    border: 1px solid var(--ink);
    border-radius: 0.5rem;
    font-weight: 600;
  }
</style>

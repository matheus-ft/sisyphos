<script lang="ts">
  import type { Template } from '../../model';
  import AddExercise from '../AddExercise.svelte';
  import { app } from '../app.svelte';
  import { programLabel } from '../format';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import { confirmDialog } from '../overlays.svelte';
  import { measureOf } from '../session';
  import {
    addTarget,
    addTemplateExercise,
    duplicateTarget,
    editTarget,
    moveTemplateExercise,
    removeTarget,
    removeTemplateExercise,
    rename,
    setIntention,
    setLabel,
    setsSummary,
    setTemplateRest,
    type TargetEdit,
  } from '../template';
  import LabelEditor from '../train/LabelEditor.svelte';
  import RestStepper from '../train/RestStepper.svelte';
  import TargetEditor from '../train/TargetEditor.svelte';

  /** A template being edited, saved as it changes: its name, intention, program label, exercises and their targets. */
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

  const edit = (index: number, target: number, change: TargetEdit) =>
    onchange(editTarget(template, index, target, change, measureAt(index)));

  /** A name cannot be empty: a blank field goes back to the name it had. */
  function renameTo(input: HTMLInputElement): void {
    const text = input.value.trim();
    if (text) onchange(rename(template, text));
    else input.value = template.name;
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
    onchange={(e) => renameTo(e.currentTarget)}
  />
</header>

<div class="intention">
  <input
    aria-label="Intention"
    placeholder="What this session is for"
    value={template.intention ?? ''}
    onchange={(e) => onchange(setIntention(template, e.currentTarget.value))}
  />
</div>

<p class="sec caps">Program label</p>
<section class="card" aria-label="Program label">
  <LabelEditor label={template.label} onchange={(change) => onchange(setLabel(template, change))} />
</section>

<p class="sec caps">
  Exercises
  {#if template.exercises.length}<span class="meta">{template.exercises.length}</span>{/if}
</p>

{#each template.exercises as entry, index (index)}
  {@const exercise = byId.get(entry.exercise_id)}
  {@const timed = measureAt(index) === 'time'}
  {@const summary = setsSummary(entry.prescribed)}
  <section class="card ex" aria-label={exercise?.name ?? entry.exercise_id}>
    <header class="ex-head">
      <div class="titles">
        <h3>{exercise?.name ?? entry.exercise_id}</h3>
        {#if summary}<p class="meta">{summary}</p>{/if}
      </div>
      <div class="order">
        <button
          class="icon-btn"
          aria-label="Move {exercise?.name ?? 'exercise'} up"
          disabled={index === 0}
          onclick={() => onchange(moveTemplateExercise(template, index, -1))}
          ><Icon name="up" size="sm" /></button
        >
        <button
          class="icon-btn down"
          aria-label="Move {exercise?.name ?? 'exercise'} down"
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

    <RestStepper
      {exercise}
      value={entry.rest_s}
      onchange={(seconds) => onchange(setTemplateRest(template, index, seconds))}
    />

    <div class="targets">
      {#each entry.prescribed as target, t (t)}
        <TargetEditor
          {target}
          number={t + 1}
          {exercise}
          {timed}
          onedit={(change) => edit(index, t, change)}
          onduplicate={() => onchange(duplicateTarget(template, index, t))}
          onremove={() => onchange(removeTarget(template, index, t))}
        />
      {/each}
    </div>
    <Button
      variant="link"
      caps
      onclick={() => onchange(addTarget(template, index, timed ? 'time' : 'weight'))}
      >+ Add set</Button
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

<p class="group-foot">
  Changes are saved as you go.{#if programLabel(template.label)}
    A session started from this one carries its program label.{/if}
</p>

<div class="acts">
  <Button variant="primary" bench full onclick={() => app.create(template)}
    >Start a session from it</Button
  >
  <Button variant="quiet" bench full onclick={() => app.create(template, { planned: true })}
    >Plan one from it</Button
  >
  <Button variant="link" class="danger" onclick={app.deleteTemplate}>Delete template</Button>
</div>

<style>
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-5) var(--gutter) var(--space-1) var(--space-1);
  }

  .name {
    flex: 1;
    min-width: 0;
    border-bottom-color: transparent;
    font: var(--fw-display) var(--fs-title) / var(--lh-snug) var(--font-display);
    letter-spacing: var(--ls-display);
  }

  .intention {
    padding: 0 var(--gutter);
  }

  .intention input {
    width: 100%;
    font-family: var(--font-text);
    font-style: italic;
    color: var(--ink-2);
  }

  .card {
    margin: 0 12px var(--space-3);
  }

  .sec .meta {
    font-family: var(--font-text);
    letter-spacing: 0;
    text-transform: none;
  }

  .ex-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .titles {
    min-width: 0;
    padding-top: var(--space-2);
  }

  .order {
    display: flex;
    flex: none;
    margin-right: -10px;
    color: var(--ink-2);
  }

  .order .icon-btn {
    color: inherit;
  }

  /* Hidden, not removed, so the other two do not shift when a lift reaches an end. */
  .order .icon-btn:disabled {
    visibility: hidden;
  }

  .down :global(svg) {
    transform: rotate(180deg);
  }

  .targets {
    margin-top: var(--space-2);
    border-top: var(--hairline) solid var(--line);
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

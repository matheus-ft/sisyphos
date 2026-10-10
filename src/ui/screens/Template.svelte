<script lang="ts">
  import type { Exercise, Template } from '../../model';
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
    exerciseHeadline,
    moveTarget,
    moveTemplateExercise,
    openAfterMove,
    openAfterRemove,
    removeTarget,
    removeTemplateExercise,
    rename,
    setIntention,
    setLabel,
    setTemplateRest,
    type TargetEdit,
  } from '../template';
  import LabelEditor from '../train/LabelEditor.svelte';
  import RestStepper from '../train/RestStepper.svelte';
  import TargetEditor from '../train/TargetEditor.svelte';

  /**
   * A template being edited, saved as it changes: its name, intention, program
   * label, exercises and their targets. Each exercise is a line saying what it
   * asks for; one at a time opens to be edited.
   */
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

  /** The exercise open for editing, if any; opening one closes the one before. */
  let open = $state<number | null>(null);

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
    if (!ok) return;
    open = openAfterRemove(open, index);
    onchange(removeTemplateExercise(template, index));
  }

  function moveExercise(index: number, by: -1 | 1): void {
    open = openAfterMove(open, index, by);
    onchange(moveTemplateExercise(template, index, by));
  }

  /** A new exercise opens, since its one empty target is what the lifter adds it to fill in. */
  function addExercise(exercise: Exercise): void {
    open = template.exercises.length;
    onchange(addTemplateExercise(template, exercise));
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
  <textarea
    aria-label="Intention"
    rows="1"
    placeholder="What this session is for"
    value={template.intention ?? ''}
    onchange={(e) => onchange(setIntention(template, e.currentTarget.value))}></textarea>
</div>

<div class="acts">
  <Button variant="primary" bench full onclick={() => app.create(template)}
    >Start a session from it</Button
  >
  <Button variant="quiet" bench full onclick={() => app.create(template, { planned: true })}
    >Plan one from it</Button
  >
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
  {@const name = exercise?.name ?? entry.exercise_id}
  {@const timed = measureAt(index) === 'time'}
  {@const expanded = open === index}
  <section class="card ex" aria-label={name}>
    <header class="ex-head">
      <button
        class="titles"
        aria-expanded={expanded}
        onclick={() => (open = expanded ? null : index)}
      >
        <span class="twirl"><Icon name="chev" size="sm" /></span>
        <span class="line">{exerciseHeadline(entry, exercise)}</span>
      </button>
      <div class="order">
        <button
          class="icon-btn"
          aria-label="Move {name} up"
          disabled={index === 0}
          onclick={() => moveExercise(index, -1)}><Icon name="up" size="sm" /></button
        >
        <button
          class="icon-btn down"
          aria-label="Move {name} down"
          disabled={index === template.exercises.length - 1}
          onclick={() => moveExercise(index, 1)}><Icon name="up" size="sm" /></button
        >
        {#if expanded}
          <button class="icon-btn" aria-label="Remove {name}" onclick={() => removeExercise(index)}
            ><Icon name="close" size="sm" /></button
          >
        {/if}
      </div>
    </header>

    {#if expanded}
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
            first={t === 0}
            last={t === entry.prescribed.length - 1}
            onmove={(by) => onchange(moveTarget(template, index, t, by))}
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
    {/if}
  </section>
{/each}

<div class="add">
  <AddExercise
    library={app.library}
    recentIds={[]}
    onpick={addExercise}
    oncreate={app.startCreating}
  />
</div>

<p class="group-foot">
  Changes are saved as you go.{#if programLabel(template.label)}
    A session started from this one carries its program label.{/if}
</p>

<div class="acts end">
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

  /* Grows with what is written: an intention is a sentence, and a line cut off reads as lost. */
  .intention textarea {
    display: block;
    width: 100%;
    resize: none;
    field-sizing: content;
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
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  /* The whole line is the tap target that opens the exercise. */
  .titles {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    min-height: var(--tap);
    text-align: left;
  }

  .twirl {
    display: inline-flex;
    flex: none;
    color: var(--muted);
    transition: transform var(--dur-fast) ease-out;
  }

  .titles[aria-expanded='true'] .twirl {
    transform: rotate(90deg);
  }

  .line {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* Open, the line is the exercise's heading and is read whole. */
  .titles[aria-expanded='true'] .line {
    white-space: normal;
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
    margin: var(--space-3) 12px 0;
  }

  .end {
    margin-top: var(--space-5);
  }

  .acts :global(.danger) {
    justify-self: center;
    color: var(--danger);
  }
</style>

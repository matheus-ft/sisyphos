<script lang="ts">
  import type { ProgramLabel } from '../../model';
  import { programLabel } from '../format';
  import { parseOrdinal, WEEKDAYS, weekdayKey } from '../template';

  /**
   * The program label a session started from the template copies: the program,
   * its block, the week and day in it, and the weekday it falls on. The line
   * under the fields is how the label will read everywhere else.
   */
  interface Props {
    label: ProgramLabel;
    onchange: (change: Partial<ProgramLabel>) => void;
  }
  let { label, onchange }: Props = $props();

  const uid = $props.id();
  const summary = $derived(programLabel(label));
  const weekday = $derived(weekdayKey(label.weekday));
  /** A weekday the picker does not know (typed by hand elsewhere) stays shown rather than lost. */
  const stray = $derived(label.weekday && !weekday ? label.weekday : null);

  const shown = (n: number | null) => (n === null ? '' : String(n));

  function ordinal(input: HTMLInputElement, key: 'block' | 'week' | 'day', was: number | null) {
    const value = parseOrdinal(input.value);
    if (value === undefined) input.value = shown(was);
    else onchange({ [key]: value });
  }

  const cap = (day: string) => day.charAt(0).toUpperCase() + day.slice(1);
</script>

<div class="grid">
  <div class="field wide">
    <label for="{uid}-name">Program</label>
    <input
      id="{uid}-name"
      value={label.name ?? ''}
      placeholder="Rebuild"
      onchange={(e) => onchange({ name: e.currentTarget.value.trim() || null })}
    />
  </div>
  <div class="field">
    <label for="{uid}-block">Block</label>
    <input
      id="{uid}-block"
      class="figure-num"
      inputmode="numeric"
      value={shown(label.block)}
      onchange={(e) => ordinal(e.currentTarget, 'block', label.block)}
    />
  </div>
  <div class="field">
    <label for="{uid}-week">Week</label>
    <input
      id="{uid}-week"
      class="figure-num"
      inputmode="numeric"
      value={shown(label.week)}
      onchange={(e) => ordinal(e.currentTarget, 'week', label.week)}
    />
  </div>
  <div class="field">
    <label for="{uid}-day">Day</label>
    <input
      id="{uid}-day"
      class="figure-num"
      inputmode="numeric"
      value={shown(label.day)}
      onchange={(e) => ordinal(e.currentTarget, 'day', label.day)}
    />
  </div>
  <div class="field">
    <label for="{uid}-weekday">Weekday</label>
    <select
      id="{uid}-weekday"
      onchange={(e) => onchange({ weekday: e.currentTarget.value || null })}
    >
      <option value="" selected={!label.weekday}>Any</option>
      {#if stray}<option value={stray} selected>{stray}</option>{/if}
      {#each WEEKDAYS as day (day)}
        <option value={day} selected={day === weekday}>{cap(day)}</option>
      {/each}
    </select>
  </div>
</div>
<p class="summary caps" aria-live="polite">{summary ?? 'No program label'}</p>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-5);
  }

  .wide {
    grid-column: 1 / -1;
  }

  .summary {
    margin-top: var(--space-3);
    color: var(--accent);
  }
</style>

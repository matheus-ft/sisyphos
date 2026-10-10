<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The four lifts that keep a record book, as tabs: Squat / Bench / Sumo /
   * Conv. The chosen tab is underlined in the figure colour; arrow keys move
   * and choose, Home and End jump. The panel under them is `children`, so the
   * tab and what it shows stay tied together for a screen reader.
   */
  interface Props {
    tabs: readonly { id: string; label: string; name: string }[];
    /** The id of the chosen tab. */
    value: string;
    onchange: (id: string) => void;
    /** What is being chosen, for a screen reader: "Lift". */
    label: string;
    children: Snippet;
  }
  let { tabs, value, onchange, label, children }: Props = $props();

  const uid = $props.id();
  const tabId = (id: string) => `${uid}-tab-${id}`;

  let list = $state<HTMLDivElement | null>(null);

  function key(event: KeyboardEvent): void {
    const at = tabs.findIndex((t) => t.id === value);
    const last = tabs.length - 1;
    let next: number;
    if (event.key === 'ArrowRight') next = at >= last ? 0 : at + 1;
    else if (event.key === 'ArrowLeft') next = at <= 0 ? last : at - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;
    event.preventDefault();
    onchange(tabs[next].id);
    list?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }
</script>

<div class="tabs" role="tablist" aria-label={label} bind:this={list}>
  {#each tabs as tab (tab.id)}
    {@const selected = tab.id === value}
    <button
      id={tabId(tab.id)}
      role="tab"
      aria-selected={selected}
      aria-controls="{uid}-panel"
      aria-label={tab.name}
      tabindex={selected ? 0 : -1}
      onkeydown={key}
      onclick={() => onchange(tab.id)}>{tab.label}</button
    >
  {/each}
</div>
<div id="{uid}-panel" role="tabpanel" aria-labelledby={tabId(value)}>
  {@render children()}
</div>

<style>
  .tabs {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    margin: var(--space-3) var(--gutter) 0;
    border-bottom: var(--hairline) solid var(--line);
  }

  /* The underline is drawn inside the target, which is the full --tap tall. */
  button {
    min-height: var(--tap);
    margin-bottom: -1px;
    padding: 0 var(--space-2);
    border-bottom: 2px solid transparent;
    font: var(--fw-display) var(--fs-label) / 1 var(--font-display);
    letter-spacing: var(--ls-caps);
    text-transform: uppercase;
    color: var(--ink-2);
  }

  button[aria-selected='true'] {
    border-bottom-color: var(--figure);
    color: var(--ink);
  }
</style>

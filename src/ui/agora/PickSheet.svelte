<script lang="ts" generics="T extends string">
  import Icon from '../kit/Icon.svelte';
  import Sheet from '../kit/Sheet.svelte';

  /**
   * A short list to choose one from, in a bottom sheet: the library's base
   * lift, tier and muscle filters. The chosen row is marked with a check; the
   * first row clears the filter.
   */
  interface Props {
    open: boolean;
    title: string;
    options: readonly { value: T; label: string; line?: string }[];
    value: T | null;
    /** The row that clears the filter: "Any tier". */
    anyLabel: string;
    onpick: (value: T | null) => void;
    onclose: () => void;
  }
  let { open, title, options, value, anyLabel, onpick, onclose }: Props = $props();
</script>

<Sheet {open} {onclose} label={title}>
  <h2 class="caps title">{title}</h2>
  <ul class="group list">
    <li class="row-link">
      <button aria-pressed={value === null} onclick={() => onpick(null)}>
        <span class="grow t">{anyLabel}</span>
        {#if value === null}<span class="mark"><Icon name="check" size="sm" stroke={2.4} /></span
          >{/if}
      </button>
    </li>
    {#each options as option (option.value)}
      <li class="row-link">
        <button aria-pressed={option.value === value} onclick={() => onpick(option.value)}>
          <span class="grow">
            <span class="t">{option.label}</span>
            {#if option.line}<span class="s">{option.line}</span>{/if}
          </span>
          {#if option.value === value}
            <span class="mark"><Icon name="check" size="sm" stroke={2.4} /></span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</Sheet>

<style>
  .title {
    margin: var(--space-2) 0 var(--space-3);
    color: var(--ink-2);
  }

  .list {
    margin: 0;
  }

  .mark {
    display: inline-flex;
    color: var(--ink);
  }
</style>

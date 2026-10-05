<script lang="ts">
  /**
   * An on/off setting, 52 × 32. Off is a sunken track; on is the figure
   * colour, the one inversion, as for anything selected.
   */
  interface Props {
    checked: boolean;
    onchange: (checked: boolean) => void;
    /** What it switches, when no visible label names it. */
    label?: string;
    /** The id of a visible label instead. */
    labelledby?: string;
    disabled?: boolean;
  }
  let { checked, onchange, label, labelledby, disabled = false }: Props = $props();
</script>

<button
  class="toggle"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  aria-labelledby={labelledby}
  {disabled}
  onclick={() => onchange(!checked)}
></button>

<style>
  .toggle {
    position: relative;
    flex: none;
    width: 52px;
    height: 32px;
    min-height: 32px;
    border: var(--stroke) solid var(--line-strong);
    border-radius: 16px;
    background: var(--sunken);
  }

  /* The hit area reaches the 44 floor beyond what is drawn. */
  .toggle::before {
    content: '';
    position: absolute;
    inset: -7px -2px;
  }

  .toggle::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 23px;
    height: 23px;
    border-radius: 50%;
    background: var(--raised);
    box-shadow: var(--shadow-1);
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .toggle[aria-checked='true'] {
    border-color: var(--figure);
    background: var(--figure);
  }

  .toggle[aria-checked='true']::after {
    transform: translateX(20px);
    background: var(--on-figure);
  }

  .toggle:disabled {
    opacity: 0.5;
  }
</style>

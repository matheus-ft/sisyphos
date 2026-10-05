<script lang="ts">
  import { answerDialog, overlays } from '../overlays.svelte';
  import Dialog from './Dialog.svelte';

  /** Renders the dialog asked for through `confirmDialog` or `promptDialog`. */
  let text = $state('');

  $effect(() => {
    const open = overlays.dialog;
    text = open?.kind === 'prompt' ? (open.value ?? '') : '';
  });
</script>

{#if overlays.dialog}
  {@const d = overlays.dialog}
  <Dialog
    open
    title={d.title}
    body={d.body}
    confirmLabel={d.confirmLabel}
    cancelLabel={d.cancelLabel}
    danger={d.kind === 'confirm' && d.danger}
    onconfirm={() => answerDialog(d.kind === 'confirm' ? true : text)}
    oncancel={() => answerDialog(d.kind === 'confirm' ? false : null)}
  >
    {#if d.kind === 'prompt'}
      <div class="field">
        <label for="dialog-field">{d.label}</label>
        <input
          id="dialog-field"
          bind:value={text}
          placeholder={d.placeholder}
          autocomplete="off"
          autocapitalize="sentences"
        />
      </div>
    {/if}
  </Dialog>
{/if}

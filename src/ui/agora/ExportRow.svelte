<script lang="ts">
  import { app } from '../app.svelte';
  import { deliver, exportFile, type ExportFile } from '../exportFile';
  import Button from '../kit/Button.svelte';
  import Icon from '../kit/Icon.svelte';
  import { showToast } from '../overlays.svelte';

  /**
   * The row that gets sets.csv and sessions.csv off the phone, shared through
   * the share sheet where the browser can, else downloaded. A list item: place
   * it in a `.group`.
   */

  async function share(name: ExportFile['name']): Promise<void> {
    // Built before the first await: iOS shares only from within the tap.
    const file = exportFile(name, app.current);
    const result = await deliver(file);
    if (result === 'downloaded') showToast({ message: `${name} downloaded` });
  }
</script>

<li class="export">
  <span class="grow t">Export</span>
  <span class="files">
    <Button variant="quiet" class="file" onclick={() => share('sets.csv')}
      ><Icon name="download" size="sm" /> sets.csv</Button
    >
    <Button variant="quiet" class="file" onclick={() => share('sessions.csv')}
      ><Icon name="download" size="sm" /> sessions.csv</Button
    >
  </span>
</li>

<style>
  .export {
    flex-wrap: wrap;
  }

  .files {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  /* File names are literal, so they are set in the text face and lower case, not in caps. */
  .files :global(.file) {
    padding: 0 var(--space-3);
    font: var(--fw-text) var(--fs-meta) / 1 var(--font-text);
    letter-spacing: 0;
    text-transform: none;
  }
</style>

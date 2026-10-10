<script lang="ts">
  import { app } from '../../app.svelte';
  import EmptyState from '../../kit/EmptyState.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';
  import TemplateFolders from '../../train/TemplateFolders.svelte';

  /** Every template, in folders by program, to open and edit, and a new one. */
</script>

<ScreenHeader title="Templates" back={{ href: routeHash({ name: 'more', page: null }) }} />

{#if app.templates.length === 0}
  <EmptyState
    title="No templates yet"
    line="Save a session as a template, or build one."
    action={{ label: 'New template', onclick: () => void app.createTemplate() }}
  />
{:else}
  <div class="list">
    <TemplateFolders templates={app.templates} />
  </div>
{/if}

<style>
  .list {
    margin-top: var(--space-2);
  }
</style>

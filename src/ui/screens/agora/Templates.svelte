<script lang="ts">
  import { app } from '../../app.svelte';
  import EmptyState from '../../kit/EmptyState.svelte';
  import Icon from '../../kit/Icon.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';
  import { templateLine } from '../../train';

  /** Every template, to open and edit, and a new one. */
</script>

<ScreenHeader title="Templates" back={{ href: routeHash({ name: 'more', page: null }) }} />

{#if app.templates.length === 0}
  <EmptyState
    title="No templates yet"
    line="Save a session as a template, or build one."
    action={{ label: 'New template', onclick: () => void app.createTemplate() }}
  />
{:else}
  <ul class="group list">
    {#each app.templates as template (template.id)}
      <li class="row-link">
        <button onclick={() => app.openTemplate(template)}>
          <span class="grow">
            <span class="t">{template.name}</span>
            <span class="s">{templateLine(template)}</span>
          </span>
          <Icon name="chev" size="sm" />
        </button>
      </li>
    {/each}
    <li class="row-link">
      <button class="new" onclick={app.createTemplate}><span class="t">+ New template</span></button
      >
    </li>
  </ul>
{/if}

<style>
  .list {
    margin-top: var(--space-2);
  }

  .new {
    color: var(--accent);
  }
</style>

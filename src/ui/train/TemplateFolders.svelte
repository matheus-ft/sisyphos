<script lang="ts" module>
  import { SvelteSet } from 'svelte/reactivity';

  /**
   * The folders the lifter has closed, kept while the app is open: a list
   * visited again, from Train or from Agora, is as it was left.
   */
  const closed = new SvelteSet<string>();
</script>

<script lang="ts">
  import type { Template } from '../../model';
  import { app } from '../app.svelte';
  import Icon from '../kit/Icon.svelte';
  import { groupTemplates } from '../template';
  import { templateLine } from '../train';

  /**
   * Every template to open, in a folder for each program label name (blocks
   * set apart inside), the folders closing to a line, and those with no
   * program last. Only when no template has a program is there nothing to
   * fold, and the list is plain. A new template is the last row.
   */
  interface Props {
    templates: readonly Template[];
  }
  let { templates }: Props = $props();

  const folders = $derived(groupTemplates(templates));
  const plain = $derived(folders.length === 1 && folders[0].name === null);

  function toggle(key: string): void {
    if (!closed.delete(key)) closed.add(key);
  }
</script>

{#snippet row(template: Template)}
  <li class="row-link">
    <button onclick={() => app.openTemplate(template)}>
      <span class="grow">
        <span class="t">{template.name}</span>
        <span class="s">{templateLine(template)}</span>
      </span>
      <Icon name="chev" size="sm" />
    </button>
  </li>
{/snippet}

<div class="folders">
  {#if plain}
    <ul class="group">
      {#each folders[0].blocks.flatMap((b) => b.templates) as template (template.id)}
        {@render row(template)}
      {/each}
    </ul>
  {:else}
    {#each folders as folder (folder.key)}
      {@const open = !closed.has(folder.key)}
      <div class="folder">
        <button class="head caps" aria-expanded={open} onclick={() => toggle(folder.key)}>
          <span class="twirl"><Icon name="chev" size="sm" /></span>
          <span class="name">{folder.name ?? 'No program'}</span>
          <span class="meta">{folder.count}</span>
        </button>
        {#if open}
          <ul class="group">
            {#each folder.blocks as block (block.block ?? 'none')}
              {#if block.block !== null}<li class="block caps">Block {block.block}</li>{/if}
              {#each block.templates as template (template.id)}
                {@render row(template)}
              {/each}
            {/each}
          </ul>
        {/if}
      </div>
    {/each}
  {/if}

  <ul class="group">
    <li class="row-link">
      <button class="new" onclick={app.createTemplate}>
        <span class="grow t">+ New template</span>
      </button>
    </li>
  </ul>
</div>

<style>
  .folders {
    display: grid;
    gap: var(--space-3);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--tap);
    padding: 0 var(--gutter);
    color: var(--ink-2);
    text-align: left;
  }

  .name {
    flex: 1;
    min-width: 0;
  }

  .twirl {
    display: inline-flex;
    transition: transform var(--dur-fast) ease-out;
  }

  .head[aria-expanded='true'] .twirl {
    transform: rotate(90deg);
  }

  /* The count is a quiet aside, not another inscription. */
  .head .meta {
    font-family: var(--font-text);
    font-size: 0.875rem;
    letter-spacing: 0;
    text-transform: none;
    color: var(--muted);
  }

  /* A block's name, set between the rows it covers. */
  .group > .block {
    min-height: 0;
    padding-block: var(--space-1);
    background: var(--raised);
    font-size: var(--fs-label);
    color: var(--muted);
  }

  .new {
    color: var(--accent);
  }
</style>

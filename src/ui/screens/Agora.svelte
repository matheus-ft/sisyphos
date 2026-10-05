<script lang="ts">
  import { app } from '../app.svelte';
  import Icon from '../kit/Icon.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';
  import { routeHash, type AgoraPage } from '../route';
  import { statusLine } from '../status';
  import Conflicts from './agora/Conflicts.svelte';
  import Library from './agora/Library.svelte';
  import Lifter from './agora/Lifter.svelte';
  import Settings from './agora/Settings.svelte';
  import Sync from './agora/Sync.svelte';
  import Templates from './agora/Templates.svelte';

  /**
   * Agora, the More tab: the lifter's data, templates, the library, conflicts,
   * sync and settings, each its own page under `#/more/<page>`.
   */
  interface Props {
    page: AgoraPage | null;
  }
  let { page }: Props = $props();

  const conflicts = $derived((app.status?.conflicts ?? 0) + (app.status?.libraryConflicts ?? 0));
  const sync = $derived(app.status ? statusLine(app.status, app.inSession).text : 'Opening…');
  const href = (p: AgoraPage) => routeHash({ name: 'more', page: p });
</script>

{#if page === 'lifter'}
  <Lifter />
{:else if page === 'templates'}
  <Templates />
{:else if page === 'library'}
  <Library />
{:else if page === 'settings'}
  <Settings />
{:else if page === 'sync'}
  <Sync />
{:else if page === 'conflicts'}
  <Conflicts />
{:else}
  <ScreenHeader title="Agora" lang="grc-Latn" />

  <p class="sec caps">Lifter</p>
  <ul class="group">
    <li class="row-link">
      <a href={href('lifter')}>
        <span class="grow">
          <span class="t">Bodyweight, maxes and records</span>
          <span class="s">What is true of you, not of one session</span>
        </span>
        <Icon name="chev" size="sm" />
      </a>
    </li>
  </ul>

  <p class="sec caps">Training</p>
  <ul class="group">
    <li class="row-link">
      <a href={href('templates')}>
        <span class="grow t">Templates</span>
        <span class="v">{app.templates.length}</span>
        <Icon name="chev" size="sm" />
      </a>
    </li>
    <li class="row-link">
      <a href={href('library')}>
        <span class="grow t">Library</span>
        <span class="v">{app.library.length} exercises</span>
        <Icon name="chev" size="sm" />
      </a>
    </li>
  </ul>

  <p class="sec caps">This device</p>
  <ul class="group">
    {#if conflicts > 0}
      <li class="row-link">
        <a href={href('conflicts')}>
          <span class="warn"><Icon name="conflict" /></span>
          <span class="grow t">Conflicts</span>
          <span class="v">{conflicts}</span>
          <Icon name="chev" size="sm" />
        </a>
      </li>
    {/if}
    <li class="row-link">
      <a href={href('sync')}>
        <span class="grow">
          <span class="t">Sync</span>
          <span class="s">{sync}</span>
        </span>
        <Icon name="chev" size="sm" />
      </a>
    </li>
    <li class="row-link">
      <a href={href('settings')}>
        <span class="grow t">Settings</span>
        <Icon name="chev" size="sm" />
      </a>
    </li>
  </ul>
{/if}

<style>
  .warn {
    display: inline-flex;
    color: var(--warning);
  }
</style>

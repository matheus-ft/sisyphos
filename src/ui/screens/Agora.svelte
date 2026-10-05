<script lang="ts">
  import { app } from '../app.svelte';
  import { aimAt, countOf, libraryValue, settingsSummary, type LifterSection } from '../agoraIndex';
  import Icon from '../kit/Icon.svelte';
  import ScreenHeader from '../kit/ScreenHeader.svelte';
  import { bodyweightSummary, maxesSummary, recordsSummary } from '../lifter';
  import { routeHash, type AgoraPage } from '../route';
  import { localDate } from '../session';
  import { statusLine } from '../status';
  import Conflicts from './agora/Conflicts.svelte';
  import Library from './agora/Library.svelte';
  import Lifter from './agora/Lifter.svelte';
  import Settings from './agora/Settings.svelte';
  import Sync from './agora/Sync.svelte';
  import Templates from './agora/Templates.svelte';

  /**
   * Agora, the More tab: the lifter's data, templates, the library, settings,
   * sync and conflicts, each its own page under `#/more/<page>`. Every row of
   * the index says what is behind it, so most visits end here.
   */
  interface Props {
    page: AgoraPage | null;
  }
  let { page }: Props = $props();

  const today = localDate(new Date());
  const conflicts = $derived((app.status?.conflicts ?? 0) + (app.status?.libraryConflicts ?? 0));
  const sync = $derived(app.status ? statusLine(app.status, app.inSession).text : 'Opening…');
  const href = (p: AgoraPage) => routeHash({ name: 'more', page: p });
</script>

{#snippet lifterRow(section: LifterSection, label: string, line: string)}
  <li class="row-link">
    <a href={href('lifter')} onclick={() => aimAt(section)}>
      <span class="grow">
        <span class="t">{label}</span>
        <span class="s">{line}</span>
      </span>
      <Icon name="chev" size="sm" />
    </a>
  </li>
{/snippet}

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
    {@render lifterRow('bodyweight', 'Bodyweight', bodyweightSummary(app.bodyweights))}
    {@render lifterRow('maxes', 'Reference maxes', maxesSummary(app.oneRms, today))}
    {@render lifterRow('records', 'Records', recordsSummary(app.manualRecords))}
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
        <span class="v">{libraryValue(app.library.length)}</span>
        <Icon name="chev" size="sm" />
      </a>
    </li>
  </ul>

  <p class="sec caps">This device</p>
  <ul class="group">
    <li class="row-link">
      <a href={href('settings')}>
        <span class="grow">
          <span class="t">Settings</span>
          <span class="s">{settingsSummary(app.prefs)}</span>
        </span>
        <Icon name="chev" size="sm" />
      </a>
    </li>
    <li class="row-link">
      <a href={href('sync')}>
        <span class="grow">
          <span class="t">Sync and export</span>
          <span class="s">{sync}</span>
        </span>
        <Icon name="chev" size="sm" />
      </a>
    </li>
  </ul>

  {#if conflicts > 0}
    <p class="sec caps">Needs you</p>
    <ul class="group">
      <li class="row-link">
        <a href={href('conflicts')}>
          <span class="warn"><Icon name="conflict" /></span>
          <span class="grow">
            <span class="t">Conflicts</span>
            <span class="s">{countOf(conflicts, 'conflict')} to settle, none lost</span>
          </span>
          <span class="v tabular">{conflicts}</span>
          <Icon name="chev" size="sm" />
        </a>
      </li>
    </ul>
  {/if}
{/if}

<style>
  .warn {
    display: inline-flex;
    color: var(--warning);
  }
</style>

<script lang="ts">
  import { maskToken } from '../../../storage/app';
  import { app } from '../../app.svelte';
  import Button from '../../kit/Button.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';
  import { routeHash } from '../../route';
  import { statusLine } from '../../status';
  import Setup from './Setup.svelte';

  /**
   * Whether this phone's log is also in the log repo, the repo and token it
   * syncs with, and syncing now. A device not set up gets the setup form here.
   */

  let repo = $state('');
  let token = $state('');
  let syncing = $state(false);
  let changing = $state(false);

  const line = $derived(app.status ? statusLine(app.status, false) : null);
  const notSetUp = $derived(app.status?.status === 'not_set_up');

  $effect(() => {
    // Reread when the status changes: a setup just finished changes both.
    void app.status;
    void read();
  });

  async function read(): Promise<void> {
    const storage = app.storage;
    if (!storage) return;
    const settings = await storage.store.settings();
    repo = settings.owner ? `${settings.owner}/${settings.repo}` : '';
    token = maskToken(settings.token);
  }

  async function syncNow(): Promise<void> {
    if (!app.storage) return;
    syncing = true;
    try {
      await app.storage.scheduler.trigger('manual');
    } finally {
      syncing = false;
    }
    await app.load();
  }
</script>

{#if notSetUp || changing}
  <Setup
    back={{
      href: changing ? undefined : routeHash({ name: 'more', page: null }),
      onclick: changing ? () => (changing = false) : undefined,
    }}
    onclose={() => (changing = false)}
  />
{:else}
  <ScreenHeader title="Sync" back={{ href: routeHash({ name: 'more', page: null }) }} />

  {#if line}<p class="line" class:alarm={line.alarm}>{line.text}</p>{/if}
  {#if app.status}<p class="meta exposure">{app.status.exposure.message}</p>{/if}

  <p class="sec caps">Log repo</p>
  <ul class="group">
    <li>
      <span class="grow t">Repository</span>
      <span class="v">{repo || 'none'}</span>
    </li>
    <li>
      <span class="grow t">Token</span>
      <span class="v tabular">{token}</span>
    </li>
  </ul>

  <div class="actions">
    <Button variant="quiet" disabled={syncing || !repo} onclick={syncNow}
      >{syncing ? 'Syncing…' : 'Sync now'}</Button
    >
    <Button variant="link" onclick={() => (changing = true)}>Change repo or token</Button>
  </div>

  {#if app.status?.unreadable.length}
    <p class="sec caps">Left alone</p>
    <p class="group-foot top">
      These files in the log repo do not read as the app writes them, so sync leaves them as they
      are. Fix or remove them on github.com.
    </p>
    <ul class="group">
      {#each app.status.unreadable as path (path)}<li class="tabular path">{path}</li>{/each}
    </ul>
  {/if}
{/if}

<style>
  .line,
  .exposure {
    margin: 0 var(--gutter);
  }

  .alarm {
    color: var(--accent);
  }

  .exposure {
    margin-top: var(--space-1);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-4) 12px 0;
  }

  .v {
    overflow-wrap: anywhere;
    white-space: normal;
    text-align: right;
  }

  .top {
    margin-bottom: var(--space-2);
  }

  .path {
    overflow-wrap: anywhere;
    font-size: var(--fs-meta);
  }
</style>

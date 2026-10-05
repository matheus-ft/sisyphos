<script lang="ts">
  import { maskToken } from '../../../storage/app';
  import ExportRow from '../../agora/ExportRow.svelte';
  import StoneSpinner from '../../agora/StoneSpinner.svelte';
  import { app } from '../../app.svelte';
  import Button from '../../kit/Button.svelte';
  import Icon from '../../kit/Icon.svelte';
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
  const busy = $derived(syncing || app.status?.status === 'syncing');
  /** The way out of a sync that stopped on the token or the repo, rather than Sync now. */
  const fix = $derived(
    app.status?.status === 'needs_token'
      ? 'Paste a new token'
      : app.status?.status === 'repo_problem'
        ? 'Change repo or token'
        : null,
  );

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

  {#if line}
    <div class="card status" class:alarm={line.alarm} role="status">
      <div class="now">
        {#if busy}
          <StoneSpinner />
        {:else if line.alarm}
          <span class="warn"><Icon name="warn" /></span>
        {:else}
          <span class="ok"><Icon name="check" /></span>
        {/if}
        <p>{line.text}</p>
      </div>
      {#if app.status}<p class="meta">{app.status.exposure.message}</p>{/if}
      {#if fix}
        <!-- Syncing again cannot help until the repo or token changes. -->
        <Button variant="primary" bench full onclick={() => (changing = true)}>{fix}</Button>
      {:else}
        <Button variant="primary" bench full disabled={busy || !repo} onclick={syncNow}
          >{busy ? 'Syncing…' : 'Sync now'}</Button
        >
      {/if}
    </div>
  {/if}

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
    <li class="row-link">
      <button onclick={() => (changing = true)}>
        <span class="grow t change">Change repo or token</span>
        <Icon name="chev" size="sm" />
      </button>
    </li>
  </ul>
  <p class="group-foot">
    The token is kept on this phone only, and shown here with its middle hidden.
  </p>

  <p class="sec caps">Export</p>
  <ul class="group">
    <ExportRow />
  </ul>
  <p class="group-foot">
    Every set and every session as a spreadsheet, for a notebook or a coach. Nothing is sent
    anywhere.
  </p>

  {#if app.status?.unreadable.length}
    <p class="sec caps">Files sync skips</p>
    <p class="group-foot top">
      These files in the log repo are not in the form the app writes, so sync leaves them as they
      are. Fix or remove them on github.com.
    </p>
    <ul class="group">
      {#each app.status.unreadable as path (path)}<li class="tabular path">{path}</li>{/each}
    </ul>
  {/if}
{/if}

<style>
  .status {
    display: grid;
    gap: var(--space-3);
    margin: var(--space-2) 12px 0;
    padding: var(--space-4);
  }

  .alarm {
    border-color: var(--warning);
    background: var(--warning-wash);
  }

  .now {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .now p {
    font-size: var(--fs-lead);
    font-weight: var(--fw-strong);
    line-height: var(--lh-snug);
  }

  .warn,
  .ok {
    display: inline-flex;
  }

  .warn {
    color: var(--warning);
  }

  .ok {
    color: var(--success);
  }

  .group .v {
    overflow-wrap: anywhere;
    white-space: normal;
    text-align: right;
  }

  .change {
    color: var(--accent);
  }

  .top {
    margin-bottom: var(--space-2);
  }

  .path {
    overflow-wrap: anywhere;
    font-size: var(--fs-meta);
  }
</style>

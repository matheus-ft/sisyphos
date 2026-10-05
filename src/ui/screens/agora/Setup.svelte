<script lang="ts">
  import { parseRepo } from '../../../storage/app';
  import { app } from '../../app.svelte';
  import Button from '../../kit/Button.svelte';
  import ScreenHeader from '../../kit/ScreenHeader.svelte';

  /**
   * Pointing this phone at the lifter's log repo. At first launch it greets the
   * lifter full screen (`greeting`), with the choice to go without sync; under
   * Agora's Sync page it is the form to set up or change the repo and token.
   */
  interface Props {
    /** The first-launch greeting, with "Use without sync" and "Not now". */
    greeting?: boolean;
    back?: { href?: string; onclick?: () => void };
    /** Called once connected, or when "Not now" is chosen. */
    onclose: () => void;
  }
  let { greeting = false, back, onclose }: Props = $props();

  let repo = $state('');
  let token = $state('');
  let busy = $state(false);
  let problem = $state<string | null>(null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = parseRepo(repo);
    if (!name) {
      problem = 'Enter the repository as owner/name, or paste its address.';
      return;
    }
    if (!token.trim()) {
      problem = 'Paste the token.';
      return;
    }
    busy = true;
    problem = null;
    try {
      const result = await app.connect({ ...name, token: token.trim() });
      if (!result.ok) problem = result.message;
      else onclose();
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }
</script>

<ScreenHeader title="Sync with your log" {back} />

<div class="body">
  <p>
    Your training is saved on this phone as you type it, and copied to a private GitHub repository
    of yours when a session ends. Losing the phone then loses nothing.
  </p>
  <p>
    On github.com, create a private repository with a README, and a fine-grained token for that
    repository only, with Contents: read and write. The steps are in
    <a href="https://github.com/matheus-ft/sisyphos/blob/master/docs/DATA.md" target="_blank"
      >DATA.md</a
    >.
  </p>

  <form onsubmit={submit}>
    <div class="field">
      <label for="setup-repo">Repository</label>
      <input
        id="setup-repo"
        bind:value={repo}
        placeholder="you/sisyphos-log"
        autocapitalize="off"
        autocomplete="off"
      />
    </div>
    <div class="field">
      <label for="setup-token">Token</label>
      <input
        id="setup-token"
        bind:value={token}
        type="password"
        placeholder="github_pat_…"
        autocomplete="off"
      />
    </div>
    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    <Button type="submit" variant="primary" bench full disabled={busy}
      >{busy ? 'Connecting…' : 'Connect'}</Button
    >
  </form>

  {#if greeting}
    <div class="later">
      <Button variant="quiet" bench onclick={app.skipSetup}>Use without sync</Button>
      <Button variant="link" onclick={onclose}>Not now</Button>
    </div>
  {/if}
</div>

<style>
  .body {
    display: grid;
    gap: var(--space-3);
    padding: 0 var(--gutter);
  }

  p {
    color: var(--ink-2);
  }

  form {
    display: grid;
    gap: var(--space-4);
    margin: var(--space-3) 0 var(--space-2);
  }

  .later {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
</style>

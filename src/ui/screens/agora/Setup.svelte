<script lang="ts">
  import { parseRepo } from '../../../storage/app';
  import { app } from '../../app.svelte';
  import Button from '../../kit/Button.svelte';
  import Meander from '../../kit/Meander.svelte';
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

<ScreenHeader
  title="Sync with your log"
  meta={greeting ? 'Optional: you can set it up later in Agora' : undefined}
  {back}
/>

<div class="body">
  {#if greeting}<div class="band"><Meander color="var(--figure)" /></div>{/if}

  <p class="lead">
    Your training is saved on this phone as you type it. Syncing copies it to a private GitHub
    repository of yours when a session ends, so losing the phone loses nothing.
  </p>

  <ol class="steps">
    <li>
      <span class="n" aria-hidden="true">I</span>
      <span>Create a private repository on github.com, with a README.</span>
    </li>
    <li>
      <span class="n" aria-hidden="true">II</span>
      <span>
        Create a fine-grained token for that repository only, with Contents: read and write.
        <a
          href="https://github.com/matheus-ft/sisyphos/blob/master/docs/DATA.md#setup-you-create-the-log-repo"
          target="_blank">The steps, one by one</a
        >.
      </span>
    </li>
  </ol>

  <form onsubmit={submit}>
    <div class="field">
      <label for="setup-repo">Repository</label>
      <input
        id="setup-repo"
        bind:value={repo}
        placeholder="you/sisyphos-log"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
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
        spellcheck="false"
      />
    </div>
    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    <Button type="submit" variant="primary" bench full disabled={busy}
      >{busy ? 'Connecting…' : 'Connect'}</Button
    >
  </form>

  {#if greeting}
    <div class="later">
      <Button variant="quiet" bench full onclick={app.skipSetup}>Use without sync</Button>
      <Button variant="link" onclick={onclose}>Not now</Button>
    </div>
  {/if}
</div>

<style>
  .body {
    display: grid;
    gap: var(--space-4);
    padding: 0 var(--gutter) var(--space-6);
  }

  .band {
    margin-top: var(--space-1);
  }

  .lead {
    font-size: var(--fs-body);
    color: var(--ink-2);
  }

  .steps {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .steps li {
    display: grid;
    grid-template-columns: 2.25rem 1fr;
    align-items: baseline;
    color: var(--ink-2);
  }

  /* Roman numerals, as an inscription would number them. */
  .n {
    font: var(--fw-display) var(--fs-label) / 1 var(--font-display);
    letter-spacing: var(--ls-caps);
    color: var(--accent);
  }

  form {
    display: grid;
    gap: var(--space-4);
    margin: var(--space-2) 0;
  }

  .later {
    display: grid;
    justify-items: center;
    gap: var(--space-2);
  }
</style>

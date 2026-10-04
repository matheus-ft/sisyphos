<script lang="ts">
  import { parseRepo } from '../storage/app';
  import type { SetupInput, SetupResult } from '../storage/setup';

  interface Props {
    onconnect: (input: SetupInput) => Promise<SetupResult>;
    onskip: () => void;
    onclose: () => void;
  }
  let { onconnect, onskip, onclose }: Props = $props();

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
      const result = await onconnect({ ...name, token: token.trim() });
      if (!result.ok) problem = result.message;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }
</script>

<section>
  <h1>Sync with your log</h1>
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
    <label>
      Repository
      <input
        bind:value={repo}
        placeholder="you/sisyphos-log"
        autocapitalize="off"
        autocomplete="off"
      />
    </label>
    <label>
      Token
      <input bind:value={token} type="password" placeholder="github_pat_…" autocomplete="off" />
    </label>
    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    <button type="submit" class="primary" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button
    >
  </form>

  <div class="later">
    <button onclick={onskip}>Use without sync</button>
    <button onclick={onclose}>Not now</button>
  </div>
</section>

<style>
  h1 {
    font-size: 1.4rem;
  }

  p {
    color: var(--ink-2);
  }

  form {
    display: grid;
    gap: 0.9rem;
    margin: 1.5rem 0;
  }

  label {
    display: grid;
    gap: 0.3rem;
    font-size: 0.9rem;
    color: var(--ink-2);
  }

  input {
    min-height: 2.75rem;
    padding: 0 0.75rem;
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 1rem;
  }

  button {
    min-height: 2.75rem;
    padding: 0 1rem;
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
  }

  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--surface);
  }

  .later {
    display: flex;
    gap: 0.5rem;
  }

  .problem {
    color: var(--accent);
  }
</style>

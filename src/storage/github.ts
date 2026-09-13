import { Conflict, type SyncAdapter } from './SyncAdapter';

/**
 * Sync backed by a private GitHub repository.
 *
 * Chosen over a storage API because it gives three things at once: the archive
 * lives somewhere the phone cannot take with it, every session is a commit with
 * a date on it, and the Contents API's sha requirement is compare-and-swap —
 * so a second device that changed the same document is detected rather than
 * silently overwritten. No server of ours is involved at any point.
 *
 * The token is the lifter's own, fine-grained, and scoped to their log repo plus
 * issue access on the public app repo. It never leaves their device except as an
 * Authorization header to github.com.
 */

export interface GitHubSyncOptions {
  owner: string;
  repo: string;
  token: string;
  branch?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

const API = 'https://api.github.com';

export class GitHubSync implements SyncAdapter {
  private readonly branch: string;
  private readonly http: typeof fetch;

  constructor(private readonly opts: GitHubSyncOptions) {
    this.branch = opts.branch ?? 'main';
    this.http = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  isConfigured(): boolean {
    return Boolean(this.opts.owner && this.opts.repo && this.opts.token);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return this.http(`${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.opts.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  }

  private contentsUrl(path: string): string {
    return `/repos/${this.opts.owner}/${this.opts.repo}/contents/${encodeURI(path)}?ref=${this.branch}`;
  }

  /**
   * Creates the log repo if it is not there yet, so setup is one pasted token
   * rather than a repository the lifter has to make and structure by hand.
   * Private, always — this is their training, not a portfolio piece.
   */
  async ensureRepo(): Promise<'created' | 'exists'> {
    const probe = await this.request(`/repos/${this.opts.owner}/${this.opts.repo}`);
    if (probe.ok) return 'exists';
    if (probe.status !== 404) throw await httpError(probe, 'checking for the log repo');

    const made = await this.request('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: this.opts.repo,
        private: true,
        auto_init: true,
        description: 'Training log. Written by Sisyphos.',
      }),
    });
    if (!made.ok) throw await httpError(made, 'creating the log repo');
    return 'created';
  }

  async pull(path: string): Promise<{ body: string; sha: string } | null> {
    const res = await this.request(this.contentsUrl(path));
    if (res.status === 404) return null;
    if (!res.ok) throw await httpError(res, `reading ${path}`);
    const json = (await res.json()) as { content: string; sha: string; encoding: string };
    return { body: decodeBase64(json.content), sha: json.sha };
  }

  /**
   * Writes a file, refusing when the remote moved underneath us.
   *
   * GitHub answers a stale sha with 409, and a missing sha on an existing file
   * with 422. Both mean the same thing here — another device got there first —
   * so both become a Conflict the caller resolves by showing the two versions.
   * Nothing is ever overwritten on our say-so.
   */
  async push(
    path: string,
    body: string,
    baseSha: string | null,
    message: string,
  ): Promise<{ sha: string }> {
    const res = await this.request(
      `/repos/${this.opts.owner}/${this.opts.repo}/contents/${encodeURI(path)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message,
          content: encodeBase64(body),
          branch: this.branch,
          ...(baseSha ? { sha: baseSha } : {}),
        }),
      },
    );

    if (res.status === 409 || res.status === 422) {
      const current = await this.pull(path);
      throw new Conflict(path, current?.sha ?? '');
    }
    if (!res.ok) throw await httpError(res, `writing ${path}`);

    const json = (await res.json()) as { content: { sha: string } };
    return { sha: json.content.sha };
  }

  /** Removing a session the lifter deleted, so the archive matches the device. */
  async remove(path: string, baseSha: string, message: string): Promise<void> {
    const res = await this.request(
      `/repos/${this.opts.owner}/${this.opts.repo}/contents/${encodeURI(path)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ message, sha: baseSha, branch: this.branch }),
      },
    );
    if (res.status === 409 || res.status === 422) throw new Conflict(path, '');
    if (!res.ok && res.status !== 404) throw await httpError(res, `deleting ${path}`);
  }

  async list(prefix: string): Promise<Array<{ path: string; sha: string }>> {
    const res = await this.request(this.contentsUrl(prefix));
    if (res.status === 404) return [];
    if (!res.ok) throw await httpError(res, `listing ${prefix}`);

    const entries = (await res.json()) as Array<{ path: string; sha: string; type: string }>;
    const out: Array<{ path: string; sha: string }> = [];
    for (const e of entries) {
      if (e.type === 'file') out.push({ path: e.path, sha: e.sha });
      // Sessions are nested by year, so one level of recursion covers the tree.
      else if (e.type === 'dir') out.push(...(await this.list(e.path)));
    }
    return out;
  }
}

async function httpError(res: Response, what: string): Promise<Error> {
  let detail = '';
  try {
    const body = (await res.json()) as { message?: string };
    detail = body.message ? ` — ${body.message}` : '';
  } catch {
    /* no JSON body */
  }
  const hint =
    res.status === 401 || res.status === 403
      ? ' Check the token has contents:write on this repository.'
      : '';
  return new Error(`GitHub returned ${res.status} while ${what}${detail}.${hint}`);
}

/** GitHub hands back base64 with newlines in it, and takes it without. */
function decodeBase64(b64: string): string {
  const clean = b64.replace(/\s/g, '');
  const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

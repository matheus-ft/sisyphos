import { FormatError, SyncError } from './errors';
import { parseFormatMarker, serializeFormatMarker } from './formats';
import { FORMAT_PATH, FORMAT_VERSION } from './paths';
import type { Remote, RepoInfo } from './remote/remote';
import type { LocalStore, Settings } from './store/store';

/**
 * Pointing a device at a log repo (docs/STORAGE.md section 8): read the repo,
 * refuse a public one, store the default branch, initialise an empty or
 * README-only repo with `sisyphos.json`, refuse a repo that is not a log, check
 * the format. Pointing at a different repo than before calls `store.resetSync()`
 * first. The caller runs the first full sync afterwards.
 *
 * Nothing on the device changes unless every check passes: a refused setup
 * leaves the settings, and the sync state, exactly as they were.
 */

export interface SetupInput {
  owner: string;
  repo: string;
  token: string;
}

/**
 * Why setup was refused. `not_found` is GitHub's 404 alone: a wrong name, or a
 * token that cannot see the repo. `repo_problem` is a repo GitHub found but that
 * cannot be used as it is (a protected branch refusing the first commit, a tree
 * too big to list, a `sisyphos.json` that is not text); its message says what,
 * in GitHub's or the adapter's words, since another name would not help.
 */
export type SetupFailure =
  'not_found' | 'repo_problem' | 'public' | 'not_a_log' | 'token' | 'needs_update' | 'network';

export type SetupResult =
  { ok: true; initialised: boolean } | { ok: false; reason: SetupFailure; message: string };

export interface SetupDeps {
  store: LocalStore;
  /** Builds the remote for these credentials; `branch` is null until the repo has been read. */
  makeRemote: (input: SetupInput & { branch: string | null }) => Remote;
}

type Refusal = Extract<SetupResult, { ok: false }>;

/** How often step 3 looks again at a repo that changed while it was being set up. */
const ROUNDS = 5;

/**
 * What GitHub's "Add a README", license and .gitignore options put in a new
 * repository. A repo holding nothing else is new, not someone else's (section 8).
 */
const SCAFFOLDING = /^(README|LICENSE)[^/]*$|^\.gitignore$/i;

const MESSAGE = 'Start a Sisyphos training log';

export async function setUp(input: SetupInput, deps: SetupDeps): Promise<SetupResult> {
  const name = `${input.owner}/${input.repo}`;
  try {
    // 1. Read the repo. This is training data: a public repo is refused.
    const info = await deps.makeRemote({ ...input, branch: null }).repoInfo();
    if (!info.private) {
      return refuse(
        'public',
        `${name} is public. Your training log must be in a private repository: make it private on GitHub, or create a new private one.`,
      );
    }

    // 2. The default branch is the log's.
    const branch = info.defaultBranch;

    // 3. Make sure it holds a log this app can read, starting one if it is new.
    const prepared = await prepare(deps.makeRemote({ ...input, branch }), name);
    if (!prepared.ok) return prepared;

    await save(deps.store, input, info);
    return prepared;
  } catch (error) {
    return failed(error);
  }
}

/** Step 3 of section 8. Loops only when the repo changes under it. */
async function prepare(remote: Remote, name: string): Promise<SetupResult> {
  const marker = serializeFormatMarker({ format: FORMAT_VERSION });

  for (let round = 0; round < ROUNDS; round++) {
    const head = await remote.head();

    if (head === null) {
      // No commits. The Git Data API cannot write to an empty repository, so
      // this is the one use of the Contents API.
      try {
        await remote.initEmpty(FORMAT_PATH, marker, MESSAGE);
        return { ok: true, initialised: true };
      } catch (error) {
        // Refused because someone made the first commit meanwhile: look again.
        if (error instanceof SyncError && error.kind === 'repo' && (await remote.head()) !== null)
          continue;
        throw error;
      }
    }

    const tree = await remote.tree(head);
    const found = tree.files.find((file) => file.path === FORMAT_PATH);
    if (found) {
      let text: string;
      try {
        text = await remote.blob(found.sha);
      } catch (error) {
        // A marker that is not even text reads no better than one that does not
        // parse (`checkFormat`).
        if (!(error instanceof FormatError)) throw error;
        return unreadableMarker(name);
      }
      return checkFormat(text, name);
    }

    if (tree.files.some((file) => !SCAFFOLDING.test(file.path))) {
      return refuse(
        'not_a_log',
        `${name} already holds files that are not a Sisyphos log. Create a new private repository for your log.`,
      );
    }

    // A new repo, with at most what GitHub offers to create with it: it becomes
    // a log by gaining the format marker, and keeps everything else as it is.
    const next = await remote.commit({
      parent: head,
      baseTree: tree.sha,
      changes: [{ path: FORMAT_PATH, content: marker }],
      message: MESSAGE,
    });
    if ((await remote.moveBranch(head, next.commit)) === 'moved') {
      return { ok: true, initialised: true };
    }
    // Someone committed meanwhile, perhaps another device setting up the same
    // repo: look again rather than assume.
  }

  return refuse('network', `${name} kept changing while it was being set up. Try again.`);
}

function unreadableMarker(name: string): SetupResult {
  return refuse(
    'not_a_log',
    `${FORMAT_PATH} in ${name} cannot be read, so this is not a log the app can use.`,
  );
}

/** Section 1.3. An older format is not setup's business: the first sync migrates it. */
function checkFormat(text: string, name: string): SetupResult {
  let format: number;
  try {
    format = parseFormatMarker(text).format;
  } catch (error) {
    if (!(error instanceof FormatError)) throw error;
    return unreadableMarker(name);
  }
  if (format > FORMAT_VERSION) {
    return refuse(
      'needs_update',
      `${name} holds a log saved by a newer version of Sisyphos. Update the app, then set it up again.`,
    );
  }
  return { ok: true, initialised: false };
}

/**
 * Saves the settings. Bases, the last synced head and the in-flight commit all
 * describe the previous repo's history; compared with another repo's files they
 * would read as deletions, so they are forgotten first (section 8). Were the
 * app killed between the two writes, the old repo would be merged from null
 * bases next time, which is safe; the other order would not be.
 */
async function save(store: LocalStore, input: SetupInput, info: RepoInfo): Promise<void> {
  if (!sameLog(await store.settings(), input, info)) await store.resetSync();
  await store.saveSettings({
    owner: input.owner,
    repo: input.repo,
    branch: info.defaultBranch,
    repo_id: info.id,
    token: input.token,
  });
}

/**
 * Whether the device already syncs with this log. A new token for it changes
 * nothing else (section 8). GitHub names ignore case, so `Me/Log` is `me/log`.
 *
 * The name is not enough. A repo deleted and created again under the same name
 * holds another history, against which the old bases would read as deletions,
 * and the first sync would delete from the device everything the new repo
 * lacks. GitHub gives it a new id, so the ids must match too; a stored id that
 * is missing or null never matches, since forgetting the bases of the same repo
 * costs one full comparison, and keeping those of another loses data. A
 * different default branch counts as another log for the same reason.
 */
function sameLog(before: Settings, input: SetupInput, info: RepoInfo): boolean {
  return (
    sameName(before.owner, input.owner) &&
    sameName(before.repo, input.repo) &&
    before.repo_id === info.id &&
    before.branch === info.defaultBranch
  );
}

function sameName(a: string | null, b: string): boolean {
  return a !== null && a.toLowerCase() === b.toLowerCase();
}

/**
 * A failure from the remote, by class (section 6). A 404 at any step means the
 * repo, or the token's view of it, is not what the lifter thinks. Any other
 * `repo` error comes from a repo GitHub found, and calling it not found would
 * send the lifter to check a name that is right.
 */
function failed(error: unknown): Refusal {
  if (!(error instanceof SyncError)) throw error;
  switch (error.kind) {
    case 'repo':
      return refuse(error.notFound ? 'not_found' : 'repo_problem', error.message);
    case 'token':
      return refuse('token', error.message);
    case 'update':
      return refuse('needs_update', error.message);
    default:
      // No network, GitHub failing or rate limiting, or an answer that made no
      // sense: nothing about the repo is known yet, and trying again may work.
      return refuse('network', error.message);
  }
}

function refuse(reason: SetupFailure, message: string): Refusal {
  return { ok: false, reason, message };
}

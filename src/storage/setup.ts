import type { Remote } from './remote/remote';
import type { LocalStore } from './store/store';

/**
 * Pointing a device at a log repo (docs/STORAGE.md section 8): read the repo,
 * refuse a public one, store the default branch, initialise an empty or
 * README-only repo with `sisyphos.json`, refuse a repo that is not a log, check
 * the format. Pointing at a different repo than before calls `store.resetSync()`
 * first. The caller runs the first full sync afterwards.
 *
 * STUB — implemented by the scheduling work package.
 */

export interface SetupInput {
  owner: string;
  repo: string;
  token: string;
}

export type SetupFailure =
  'not_found' | 'public' | 'not_a_log' | 'token' | 'needs_update' | 'network';

export type SetupResult =
  { ok: true; initialised: boolean } | { ok: false; reason: SetupFailure; message: string };

export interface SetupDeps {
  store: LocalStore;
  /** Builds the remote for these credentials; `branch` is null until the repo has been read. */
  makeRemote: (input: SetupInput & { branch: string | null }) => Remote;
}

export function setUp(_input: SetupInput, _deps: SetupDeps): Promise<SetupResult> {
  throw new Error('not implemented: storage/setup');
}

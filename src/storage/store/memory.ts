import { blobSha } from '../hash';
import {
  nextUnsyncedSince,
  type Exclusive,
  type Inflight,
  type LocalStore,
  type Settings,
  type StoreOp,
  type SyncEntry,
  type SyncMeta,
} from './store';

/**
 * The store in memory: for tests and the multi-device simulation.
 *
 * Its state is plain data, so `restart()` can hand the same "disk" to a fresh
 * instance, which is how the simulation kills and revives a device. `apply` is
 * all-or-nothing, like an IndexedDB transaction.
 */

interface State {
  content: Map<string, string>;
  entries: Map<string, SyncEntry>;
  meta: SyncMeta;
  inflight: Inflight | null;
  settings: Settings;
}

export interface MemoryStoreOptions {
  now?: () => Date;
  deviceId?: string;
}

function copy(state: State): State {
  return {
    content: new Map(state.content),
    entries: new Map([...state.entries].map(([k, v]) => [k, { ...v }])),
    meta: { ...state.meta },
    inflight: state.inflight ? structuredClone(state.inflight) : null,
    settings: { ...state.settings },
  };
}

export class MemoryStore implements LocalStore {
  private state: State;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => Date;

  constructor(options: MemoryStoreOptions = {}, state?: State) {
    this.now = options.now ?? (() => new Date());
    this.state = state ?? {
      content: new Map(),
      entries: new Map(),
      meta: { last_synced_head: null, last_synced_tree: null },
      inflight: null,
      settings: {
        owner: null,
        repo: null,
        branch: null,
        repo_id: null,
        token: null,
        device_id: options.deviceId ?? crypto.randomUUID(),
      },
    };
  }

  /** A new instance over the same persisted state, as if the app had been killed and relaunched. */
  restart(options: MemoryStoreOptions = {}): MemoryStore {
    return new MemoryStore({ now: options.now ?? this.now }, copy(this.state));
  }

  // --- reads -------------------------------------------------------------------

  async content(path: string): Promise<string | null> {
    return this.state.content.get(path) ?? null;
  }

  async paths(): Promise<string[]> {
    return [...new Set([...this.state.content.keys(), ...this.state.entries.keys()])].sort();
  }

  async entry(path: string): Promise<SyncEntry | null> {
    const e = this.state.entries.get(path);
    return e ? { ...e } : null;
  }

  async entries(): Promise<SyncEntry[]> {
    return (
      [...this.state.entries.values()]
        .map((e) => ({ ...e }))
        // Plain code-unit order, the same as `paths()` and IndexedDB's key order.
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    );
  }

  async meta(): Promise<SyncMeta> {
    return { ...this.state.meta };
  }

  async inflight(): Promise<Inflight | null> {
    return this.state.inflight ? structuredClone(this.state.inflight) : null;
  }

  async settings(): Promise<Settings> {
    return { ...this.state.settings };
  }

  // --- writes ------------------------------------------------------------------

  exclusive<T>(fn: (store: Exclusive) => Promise<T>): Promise<T> {
    const handle: Exclusive = {
      content: (p) => this.content(p),
      paths: () => this.paths(),
      entry: (p) => this.entry(p),
      entries: () => this.entries(),
      meta: () => this.meta(),
      inflight: () => this.inflight(),
      apply: async (ops) => this.applyNow(ops),
    };
    const run = this.queue.then(() => fn(handle));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async saveSettings(patch: Partial<Omit<Settings, 'device_id'>>): Promise<void> {
    await this.exclusive(async () => {
      this.state.settings = { ...this.state.settings, ...patch };
    });
  }

  async resetSync(): Promise<void> {
    await this.exclusive(async () => {
      const now = this.now().toISOString();
      const entries = new Map<string, SyncEntry>();
      for (const [path, text] of this.state.content) {
        const local_sha = blobSha(text);
        entries.set(path, {
          path,
          base_sha: null,
          local_sha,
          unsynced_since: nextUnsyncedSince(null, { local_sha, base_sha: null }, now),
          base_body: null,
        });
      }
      this.state.entries = entries;
      this.state.meta = { last_synced_head: null, last_synced_tree: null };
      this.state.inflight = null;
    });
  }

  /** Applies ops to a copy and swaps it in only if every op succeeded. */
  private applyNow(ops: StoreOp[]): void {
    const next = copy(this.state);
    const now = this.now().toISOString();

    for (const op of ops) {
      switch (op.op) {
        case 'content': {
          if (op.text === null) next.content.delete(op.path);
          else next.content.set(op.path, op.text);
          const previous = next.entries.get(op.path) ?? null;
          const local_sha = op.text === null ? null : blobSha(op.text);
          const base_sha = previous?.base_sha ?? null;
          setEntry(next, {
            path: op.path,
            base_sha,
            local_sha,
            unsynced_since: nextUnsyncedSince(previous, { local_sha, base_sha }, now),
            base_body: previous?.base_body ?? null,
          });
          break;
        }
        case 'base': {
          const previous = next.entries.get(op.path) ?? null;
          const local_sha = previous?.local_sha ?? null;
          setEntry(next, {
            path: op.path,
            base_sha: op.sha,
            local_sha,
            unsynced_since: nextUnsyncedSince(previous, { local_sha, base_sha: op.sha }, now),
            base_body: op.body ?? null,
          });
          break;
        }
        case 'meta':
          next.meta = { ...op.meta };
          break;
        case 'inflight':
          next.inflight = op.inflight ? structuredClone(op.inflight) : null;
          break;
        default:
          throw new Error(`Unknown store op: ${JSON.stringify(op satisfies never)}`);
      }
    }

    this.state = next;
  }
}

/** An entry with neither content nor base carries nothing, so it is dropped. */
function setEntry(state: State, entry: SyncEntry): void {
  if (entry.local_sha === null && entry.base_sha === null) state.entries.delete(entry.path);
  else state.entries.set(entry.path, entry);
}

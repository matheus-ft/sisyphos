import { openDB, unwrap, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
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
 * The store on the device, in IndexedDB (docs/STORAGE.md section 2). Must
 * behave exactly like `MemoryStore`; both run the same contract test suite.
 *
 * - One write queue: `exclusive` runs callbacks first in, first out, and holds
 *   a Web Lock while each runs, so a second tab's writes cannot land between
 *   another tab's read and its write either.
 * - `apply` is one IndexedDB transaction with no `await` between its requests.
 *   IndexedDB commits a transaction as soon as the microtask queue drains with
 *   nothing pending, so an `await` between two requests can split one write in
 *   two. Everything, hashes included, is computed before the transaction opens,
 *   and the only thing awaited is its completion.
 * - The schema is versioned, and upgrading never drops data.
 * - The device id is generated once, when the database is created, and kept.
 */

export const DB_NAME = 'sisyphos';

/** Singleton stores hold their one record under this key. */
const ONLY = 'current';

interface Schema extends DBSchema {
  /** The device's content for each log-repo path. */
  content: { key: string; value: { path: string; text: string } };
  sync: { key: string; value: SyncEntry };
  sync_meta: { key: string; value: SyncMeta };
  inflight: { key: string; value: Inflight };
  settings: { key: string; value: Settings };
}

type StoreName = 'content' | 'sync' | 'sync_meta' | 'inflight' | 'settings';
const STORES: StoreName[] = ['content', 'sync', 'sync_meta', 'inflight', 'settings'];

type Upgrade = (
  db: IDBPDatabase<Schema>,
  tx: IDBPTransaction<Schema, StoreName[], 'versionchange'>,
) => void;

/**
 * `MIGRATIONS[n]` takes the database from version n to n + 1, inside the
 * upgrade transaction. A later version appends a step: it may add stores and
 * rewrite records, and must carry every record forward (2.1).
 */
const MIGRATIONS: Upgrade[] = [
  (db, tx) => {
    db.createObjectStore('content', { keyPath: 'path' });
    db.createObjectStore('sync', { keyPath: 'path' });
    db.createObjectStore('sync_meta');
    db.createObjectStore('inflight');
    db.createObjectStore('settings');
    // Here, and only here: the upgrade to version 1 runs once per install, and
    // two tabs opening a fresh install cannot both run it.
    const settings: Settings = {
      owner: null,
      repo: null,
      branch: null,
      token: null,
      device_id: crypto.randomUUID(),
    };
    unwrap(tx).objectStore('settings').put(settings, ONLY);
  },
];

const VERSION = MIGRATIONS.length;

const NO_META: SyncMeta = { last_synced_head: null, last_synced_tree: null };

export interface IndexedDbStoreOptions {
  now?: () => Date;
}

export class IndexedDbStore implements LocalStore {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly db: IDBPDatabase<Schema>,
    private readonly name: string,
    private readonly now: () => Date,
  ) {}

  static async open(
    name: string = DB_NAME,
    options: IndexedDbStoreOptions = {},
  ): Promise<IndexedDbStore> {
    const db = await openDB<Schema>(name, VERSION, {
      upgrade(database, oldVersion, _newVersion, tx) {
        for (let version = oldVersion; version < VERSION; version++) {
          MIGRATIONS[version](database, tx);
        }
      },
      // A newer build, opened in another tab, is waiting to upgrade. This
      // connection would block it for as long as this tab lives, so it lets go;
      // this tab's later reads and writes fail until it reloads as that build.
      blocking() {
        db.close();
      },
    });
    return new IndexedDbStore(db, name, options.now ?? (() => new Date()));
  }

  close(): void {
    this.db.close();
  }

  // --- reads -------------------------------------------------------------------

  async content(path: string): Promise<string | null> {
    return (await this.db.get('content', path))?.text ?? null;
  }

  async paths(): Promise<string[]> {
    const tx = this.db.transaction(['content', 'sync']);
    const [content, entries] = await Promise.all([
      tx.objectStore('content').getAllKeys(),
      tx.objectStore('sync').getAllKeys(),
    ]);
    return [...new Set([...content, ...entries])].sort();
  }

  async entry(path: string): Promise<SyncEntry | null> {
    return (await this.db.get('sync', path)) ?? null;
  }

  async entries(): Promise<SyncEntry[]> {
    // Sorted as `MemoryStore` sorts them, not in IndexedDB's key order.
    return (await this.db.getAll('sync')).sort((a, b) => a.path.localeCompare(b.path));
  }

  async meta(): Promise<SyncMeta> {
    return (await this.db.get('sync_meta', ONLY)) ?? { ...NO_META };
  }

  async inflight(): Promise<Inflight | null> {
    return (await this.db.get('inflight', ONLY)) ?? null;
  }

  async settings(): Promise<Settings> {
    const settings = await this.db.get('settings', ONLY);
    if (!settings) throw new Error(`${this.name} has no settings record`);
    return settings;
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
      apply: (ops) => this.applyNow(ops),
    };
    const run = this.queue.then(() => this.acrossTabs(() => fn(handle)));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async saveSettings(patch: Partial<Omit<Settings, 'device_id'>>): Promise<void> {
    await this.exclusive(async () => {
      const settings = { ...(await this.settings()), ...patch };
      await this.write((tx) => {
        tx.objectStore('settings').put(settings, ONLY);
      });
    });
  }

  async resetSync(): Promise<void> {
    await this.exclusive(async () => {
      const now = this.now().toISOString();
      const entries = (await this.db.getAll('content')).map(({ path, text }): SyncEntry => {
        const local_sha = blobSha(text);
        return {
          path,
          base_sha: null,
          local_sha,
          unsynced_since: nextUnsyncedSince(null, { local_sha, base_sha: null }, now),
          base_body: null,
        };
      });
      await this.write((tx) => {
        const sync = tx.objectStore('sync');
        sync.clear();
        for (const entry of entries) sync.put(entry);
        tx.objectStore('sync_meta').put(NO_META, ONLY);
        tx.objectStore('inflight').delete(ONLY);
      });
    });
  }

  /**
   * Each tab has its own queue, but every tab writes to the same database, so
   * the queue alone would let another tab's write land between this tab's read
   * and its write, and be overwritten. The lock is per database, and Web Locks
   * grant it first come, first served.
   */
  private acrossTabs<T>(fn: () => Promise<T>): Promise<T> {
    const locks = globalThis.navigator?.locks;
    return locks ? locks.request(`sisyphos-store:${this.name}`, fn) : fn();
  }

  /**
   * Computes everything the ops leave behind, then writes it in one
   * transaction. The same steps as `MemoryStore.applyNow`, in the same order,
   * over just the entries the ops touch.
   */
  private async applyNow(ops: StoreOp[]): Promise<void> {
    if (ops.length === 0) return;
    const now = this.now().toISOString();

    const touched = [
      ...new Set(ops.flatMap((op) => (op.op === 'content' || op.op === 'base' ? [op.path] : []))),
    ];
    const tx = this.db.transaction('sync');
    const found = await Promise.all(touched.map((path) => tx.store.get(path)));
    // Null: the path has no entry, or will have none once the ops are applied.
    const entries = new Map(touched.map((path, i) => [path, found[i] ?? null]));

    const content = new Map<string, string | null>();
    let meta: SyncMeta | undefined;
    let inflight: Inflight | null | undefined;

    for (const op of ops) {
      switch (op.op) {
        case 'content': {
          content.set(op.path, op.text);
          const previous = entries.get(op.path) ?? null;
          const local_sha = op.text === null ? null : blobSha(op.text);
          const base_sha = previous?.base_sha ?? null;
          entries.set(
            op.path,
            kept({
              path: op.path,
              base_sha,
              local_sha,
              unsynced_since: nextUnsyncedSince(previous, { local_sha, base_sha }, now),
              base_body: previous?.base_body ?? null,
            }),
          );
          break;
        }
        case 'base': {
          const previous = entries.get(op.path) ?? null;
          const local_sha = previous?.local_sha ?? null;
          entries.set(
            op.path,
            kept({
              path: op.path,
              base_sha: op.sha,
              local_sha,
              unsynced_since: nextUnsyncedSince(previous, { local_sha, base_sha: op.sha }, now),
              base_body: op.body ?? null,
            }),
          );
          break;
        }
        case 'meta':
          meta = op.meta;
          break;
        case 'inflight':
          inflight = op.inflight;
          break;
        default:
          throw new Error(`Unknown store op: ${JSON.stringify(op satisfies never)}`);
      }
    }

    await this.write((tx) => {
      const contentStore = tx.objectStore('content');
      for (const [path, text] of content) {
        if (text === null) contentStore.delete(path);
        else contentStore.put({ path, text });
      }
      const syncStore = tx.objectStore('sync');
      for (const [path, entry] of entries) {
        if (entry === null) syncStore.delete(path);
        else syncStore.put(entry);
      }
      if (meta !== undefined) tx.objectStore('sync_meta').put(meta, ONLY);
      if (inflight === null) tx.objectStore('inflight').delete(ONLY);
      else if (inflight !== undefined) tx.objectStore('inflight').put(inflight, ONLY);
    });
  }

  /**
   * One readwrite transaction, all or nothing. `issue` makes every request,
   * synchronously, on the raw transaction: it cannot await, so nothing can
   * separate two requests, and a failed request aborts the transaction instead
   * of leaving a promise to reject unhandled. Resolves once it has committed.
   */
  private async write(issue: (tx: IDBTransaction) => void): Promise<void> {
    const tx = this.db.transaction(STORES, 'readwrite');
    try {
      issue(unwrap(tx));
    } catch (e) {
      // A request that could not even be made, such as a value that cannot be
      // cloned. Those made before it are pending, and would commit on their own.
      try {
        tx.abort();
      } catch {
        // Already aborted.
      }
      await tx.done.catch(() => undefined);
      throw e;
    }
    await tx.done;
  }
}

/** An entry with neither content nor base carries nothing, so it is dropped. */
function kept(entry: SyncEntry): SyncEntry | null {
  return entry.local_sha === null && entry.base_sha === null ? null : entry;
}

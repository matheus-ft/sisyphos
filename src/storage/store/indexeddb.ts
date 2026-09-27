import type { Exclusive, Inflight, LocalStore, Settings, SyncEntry, SyncMeta } from './store';

/**
 * The store on the device, in IndexedDB (docs/STORAGE.md section 2). Must
 * behave exactly like `MemoryStore`; both run the same contract test suite.
 *
 * Requirements the implementation must meet:
 * - one write queue: `exclusive` runs callbacks first in, first out;
 * - `apply` is one IndexedDB transaction, with no `await` between its requests
 *   (compute everything, including hashes, before opening it);
 * - the schema is versioned, and upgrading never drops data;
 * - the device id is generated once, on first open, and kept.
 *
 * STUB — implemented by the store work package.
 */

export const DB_NAME = 'sisyphos';

export class IndexedDbStore implements LocalStore {
  static async open(_name: string = DB_NAME): Promise<IndexedDbStore> {
    throw new Error('not implemented: store/indexeddb');
  }

  content(_path: string): Promise<string | null> {
    throw new Error('not implemented: store/indexeddb');
  }
  paths(): Promise<string[]> {
    throw new Error('not implemented: store/indexeddb');
  }
  entry(_path: string): Promise<SyncEntry | null> {
    throw new Error('not implemented: store/indexeddb');
  }
  entries(): Promise<SyncEntry[]> {
    throw new Error('not implemented: store/indexeddb');
  }
  meta(): Promise<SyncMeta> {
    throw new Error('not implemented: store/indexeddb');
  }
  inflight(): Promise<Inflight | null> {
    throw new Error('not implemented: store/indexeddb');
  }
  exclusive<T>(_fn: (store: Exclusive) => Promise<T>): Promise<T> {
    throw new Error('not implemented: store/indexeddb');
  }
  settings(): Promise<Settings> {
    throw new Error('not implemented: store/indexeddb');
  }
  saveSettings(_patch: Partial<Omit<Settings, 'device_id'>>): Promise<void> {
    throw new Error('not implemented: store/indexeddb');
  }
  resetSync(): Promise<void> {
    throw new Error('not implemented: store/indexeddb');
  }
}

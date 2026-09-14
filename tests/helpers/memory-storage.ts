import type { StorageAdapter } from '../../src/storage/StorageAdapter';
import type {
  BodyweightEntry,
  Exercise,
  ManualRecord,
  Muscle,
  OneRmEntry,
  Session,
  Template,
} from '../../src/model';
import { PATHS } from '../../src/storage/paths';

/**
 * A storage adapter held in plain objects.
 *
 * The engine's job is orchestration — when to write, when to push, and what to
 * do when the remote moved — and none of that is about IndexedDB. Driving those
 * tests through a simulated IndexedDB measures the simulation as much as the
 * engine; the real adapter has its own tests against fake-indexeddb.
 */
export class MemoryStorage implements StorageAdapter {
  sessions = new Map<string, Session>();
  templates = new Map<string, Template>();
  localExercises = new Map<string, Exercise>();
  oneRm: OneRmEntry[] = [];
  manualRecords = new Map<string, ManualRecord>();
  bodyweight = new Map<string, BodyweightEntry>();
  private dirty = new Map<string, number>();
  private shas = new Map<string, string>();
  private seq = 0;

  private mark(path: string) {
    this.dirty.set(path, ++this.seq);
  }

  async getSession(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async listSessions(from: string, to: string) {
    return [...this.sessions.values()]
      .filter((s) => s.date >= from && s.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  async listIncompleteSessions() {
    return [...this.sessions.values()].filter((s) =>
      s.exercises.some((x) => x.performed.some((p) => p.state === 'pending')),
    );
  }
  async listOpenSessions() {
    return [...this.sessions.values()].filter((s) => s.ended_at === null);
  }
  async putSession(s: Session) {
    this.sessions.set(s.id, s);
    this.mark(PATHS.session(s));
  }
  async deleteSession(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    this.mark(PATHS.session(s));
  }

  async getTemplates() {
    return [...this.templates.values()];
  }
  async putTemplate(t: Template) {
    this.templates.set(t.id, t);
    this.mark(PATHS.templates);
  }
  async deleteTemplate(id: string) {
    this.templates.delete(id);
    this.mark(PATHS.templates);
  }

  async getMuscles(): Promise<Muscle[]> {
    return [];
  }
  async getExercises() {
    return [...this.localExercises.values()];
  }
  async getLocalExercises() {
    return [...this.localExercises.values()];
  }
  async addLocalExercise(e: Exercise) {
    this.localExercises.set(e.id, e);
    this.mark(PATHS.localExercises);
  }

  async getOneRmHistory() {
    return [...this.oneRm].sort((a, b) => a.date.localeCompare(b.date));
  }
  async putOneRmEntry(e: OneRmEntry) {
    this.oneRm.push(e);
    this.mark(PATHS.oneRm);
  }
  async oneRmAsOf(lift: string, date: string) {
    const rows = (await this.getOneRmHistory()).filter((r) => r.lift === lift && r.date <= date);
    return rows.length ? rows[rows.length - 1].weight_kg : null;
  }

  async getManualRecords() {
    return [...this.manualRecords.values()];
  }
  async putManualRecord(r: ManualRecord) {
    this.manualRecords.set(r.id, r);
    this.mark(PATHS.manualRecords);
  }
  async deleteManualRecord(id: string) {
    this.manualRecords.delete(id);
    this.mark(PATHS.manualRecords);
  }

  async getBodyweightHistory() {
    return [...this.bodyweight.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  async putBodyweightEntry(e: BodyweightEntry) {
    this.bodyweight.set(e.date, e);
    this.mark(PATHS.bodyweight);
  }
  async bodyweightHintFor(date: string, maxAgeDays: number) {
    const rows = await this.getBodyweightHistory();
    let best: BodyweightEntry | null = null;
    for (const r of rows) {
      if (r.date > date) continue;
      if ((Date.parse(date) - Date.parse(r.date)) / 86_400_000 <= maxAgeDays) best = r;
    }
    return best;
  }

  async listDirty() {
    return [...this.dirty.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([path]) => ({ path, body: this.serialize(path) }));
  }
  async markClean(path: string, sha: string) {
    this.dirty.delete(path);
    this.shas.set(path, sha);
  }
  async knownSha(path: string) {
    return this.shas.get(path) ?? null;
  }
  async oldestDirtyAt() {
    return this.dirty.size ? new Date(Date.now() - 60_000) : null;
  }

  /** Mirrors the real adapter: a removed session serialises empty. */
  private serialize(path: string): string {
    if (path.startsWith('sessions/')) {
      const id = path
        .split('_')
        .pop()!
        .replace(/\.json$/, '');
      const s = this.sessions.get(id);
      return s ? JSON.stringify(s, null, 2) + '\n' : '';
    }
    if (path === PATHS.templates) return JSON.stringify([...this.templates.values()]);
    if (path === PATHS.localExercises) return JSON.stringify([...this.localExercises.values()]);
    if (path === PATHS.oneRm) return JSON.stringify(this.oneRm);
    if (path === PATHS.manualRecords) return JSON.stringify([...this.manualRecords.values()]);
    if (path === PATHS.bodyweight) return JSON.stringify([...this.bodyweight.values()]);
    return '{}';
  }
}

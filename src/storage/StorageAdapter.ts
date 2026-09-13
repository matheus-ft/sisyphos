import type {
  BodyweightEntry,
  Exercise,
  Muscle,
  ManualRecord,
  OneRmEntry,
  Session,
  Template,
} from '../model';

/**
 * The persistence seam. Everything that touches storage goes through this, so
 * replacing IndexedDB with something else is one new implementation and no other
 * changes.
 */
export interface StorageAdapter {
  // --- sessions: one document each, the unit of sync ---
  getSession(id: string): Promise<Session | null>;
  /** Inclusive date range. The only aggregation query analysis ever needs. */
  listSessions(fromDate: string, toDate: string): Promise<Session[]>;
  /** Sessions with at least one pending set — the "needs input" queue. */
  listIncompleteSessions(): Promise<Session[]>;
  /** Sessions with no ended_at, for the 12-hour staleness nudge. */
  listOpenSessions(): Promise<Session[]>;
  putSession(session: Session): Promise<void>;
  deleteSession(id: string): Promise<void>;

  // --- templates ---
  getTemplates(): Promise<Template[]>;
  putTemplate(t: Template): Promise<void>;
  deleteTemplate(id: string): Promise<void>;

  // --- library: read-only for muscles, append-only for exercises ---
  /**
   * The muscle vocabulary. Read-only by design and there is deliberately no
   * writer: exercises reference these ids permanently, so a lifter renaming one
   * would silently break every exercise pointing at it. Changing the vocabulary
   * is a change to the app, through a pull request like any other.
   */
  getMuscles(): Promise<Muscle[]>;

  /** The shipped library plus this lifter's not-yet-upstreamed additions. */
  getExercises(): Promise<Exercise[]>;
  /**
   * Records a locally created exercise so it works offline immediately. The
   * upstream change is a pull request, opened from a submitted issue — nothing
   * here ever commits to the shared library directly.
   */
  addLocalExercise(e: Exercise): Promise<void>;
  /** Local additions only, for showing what is still awaiting review. */
  getLocalExercises(): Promise<Exercise[]>;

  // --- reference maxes: drive percentage prescriptions ---
  getOneRmHistory(): Promise<OneRmEntry[]>;
  putOneRmEntry(e: OneRmEntry): Promise<void>;
  /**
   * The reference max in force on a date. Percentage prescriptions resolve
   * against this, so raising your 1RM never rewrites what a past session asked.
   */
  oneRmAsOf(lift: string, date: string): Promise<number | null>;

  /**
   * Records with no session behind them — competition lifts, and everything you
   * did before this app existed. This is how you enter your current records on
   * day one, and no recompute will ever touch them. Records that DO come from
   * logged sets are derived by scanning sessions and are never stored, so there
   * is nothing to keep in sync.
   */
  getManualRecords(): Promise<ManualRecord[]>;
  putManualRecord(r: ManualRecord): Promise<void>;
  deleteManualRecord(id: string): Promise<void>;

  // --- bodyweight ---
  getBodyweightHistory(): Promise<BodyweightEntry[]>;
  putBodyweightEntry(e: BodyweightEntry): Promise<void>;
  /** Most recent reading within `maxAgeDays`. Offered as a hint only — never pre-filled. */
  bodyweightHintFor(date: string, maxAgeDays: number): Promise<BodyweightEntry | null>;

  // --- sync bookkeeping ---
  /** Documents changed since their last successful push. */
  listDirty(): Promise<Array<{ path: string; body: string }>>;
  markClean(path: string, remoteSha: string): Promise<void>;
}

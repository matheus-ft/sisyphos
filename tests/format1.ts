import type { ConflictRecord, Session, Template } from '../src/model';
import { serializeConflict, serializeSession, serializeTemplate } from '../src/storage/formats';

/**
 * Files as format 1 wrote them, for the migration's tests: format 2's bytes
 * less what format 2 added (a template's label, each exercise's rest_s). The
 * keys format 1 had came in the same order, so this is exactly its output.
 */

type Json = Record<string, unknown>;

function withoutFormat2(record: Json, kind: 'session' | 'template'): Json {
  if (kind === 'template') delete record.label;
  for (const exercise of record.exercises as Json[]) delete exercise.rest_s;
  return record;
}

function text(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sessionV1(session: Session): string {
  return text(withoutFormat2(JSON.parse(serializeSession(session)), 'session'));
}

export function templateV1(template: Template): string {
  return text(withoutFormat2(JSON.parse(serializeTemplate(template)), 'template'));
}

export function conflictV1(conflict: ConflictRecord): string {
  const value = JSON.parse(serializeConflict(conflict));
  if (value.version !== null && value.key === null) {
    withoutFormat2(value.version, value.path.startsWith('sessions/') ? 'session' : 'template');
  }
  return text(value);
}

export const MARKER_V1 = '{\n  "format": 1\n}\n';

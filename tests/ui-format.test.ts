import { describe, expect, it } from 'vitest';
import type { PerformedSet } from '../src/model';
import {
  dayAndMonth,
  dayOfMonth,
  formatMinutes,
  longDate,
  programLabel,
  sessionMinutes,
  shortDate,
  weekOf,
  weekday,
  weekdayShort,
  workingSets,
} from '../src/ui/format';
import { newSession, setDate } from '../src/ui/session';

const session = () =>
  newSession({
    id: 's',
    at: new Date('2026-10-04T17:00:00.000Z'),
    tz: 'Europe/Lisbon',
    deviceId: 'phone',
  });

const done = (warmup = false): PerformedSet => ({
  id: crypto.randomUUID(),
  prescribed_id: null,
  state: 'done',
  reps: 5,
  rpe: warmup ? null : 8,
  load: { kind: 'weight', value: 100, unit: 'kg' },
  is_warmup: warmup,
  notes: null,
});

describe('dates as the copy writes them', () => {
  it('writes the long date, the short one and the weekday', () => {
    expect(longDate('2026-10-04')).toBe('Sunday 4 October');
    expect(shortDate('2026-10-04')).toBe('4 Oct');
    expect(weekday('2026-10-01')).toBe('Thursday');
    expect(weekdayShort('2026-10-01')).toBe('THU');
    expect(dayOfMonth('2026-10-01')).toBe(1);
    expect(dayAndMonth('2026-09-28')).toBe('28 September');
  });

  it('keys a week by its Monday', () => {
    expect(weekOf('2026-10-04')).toBe('2026-09-28');
    expect(weekOf('2026-09-28')).toBe('2026-09-28');
    expect(weekOf('2026-10-05')).toBe('2026-10-05');
    expect(weekOf('2027-01-01')).toBe('2026-12-28');
  });
});

describe('how long a session ran', () => {
  it('counts whole minutes to its end, or to now while it runs', () => {
    const s = session();
    const end = new Date('2026-10-04T17:52:30.000Z').toISOString();
    expect(sessionMinutes({ ...s, ended_at: end })).toBe(52);
    expect(sessionMinutes(s, Date.parse('2026-10-04T17:05:00.000Z'))).toBe(5);
  });

  it('says nothing for a session planned, or logged after the fact', () => {
    expect(sessionMinutes({ ...session(), started_at: null })).toBeNull();
    expect(sessionMinutes(setDate(session(), '2026-09-01'))).toBeNull();
  });

  it('writes minutes, and hours past the hour', () => {
    expect(formatMinutes(52)).toBe('52 min');
    expect(formatMinutes(65)).toBe('1 h 5 min');
  });
});

describe('what a session holds', () => {
  it('counts done working sets, not warm-ups', () => {
    const s = session();
    const exercises = [
      { id: 'i', exercise_id: 'x', prescribed: [], notes: null, performed: [done(true), done()] },
    ];
    expect(workingSets({ ...s, exercises })).toBe(1);
  });

  it('writes the program label, dropping empty parts', () => {
    expect(programLabel({ name: 'Rebuild', block: 2, week: 3, day: 1, weekday: 'sunday' })).toBe(
      'Rebuild · block 2 · week 3 · day 1 · Sun',
    );
    expect(programLabel({ name: null, block: null, week: 3, day: null, weekday: null })).toBe(
      'week 3',
    );
    expect(
      programLabel({ name: null, block: null, week: null, day: null, weekday: null }),
    ).toBeNull();
  });
});

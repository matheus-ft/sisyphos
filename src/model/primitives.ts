/** Scalars shared by every other model file. */

/** Stable client-generated id, sortable by creation time (UUIDv7-style). */
export type Id = string;

/** ISO-8601 UTC instant, e.g. "2026-09-14T06:30:00.000Z". */
export type Instant = string;

/** Calendar date, "YYYY-MM-DD". The aggregation key for all analysis. */
export type IsoDate = string;

/**
 * A prescribed range. `[n, n]` is a scalar.
 * A null bound means unbounded on that side: `[5, null]` is "at least 5, then
 * AMRAP"; `[null, 8]` is an AMRAP capped at 8 reps; `[null, null]` is fully open.
 */
export type Interval = [number | null, number | null];

/**
 * What a logged load is measured in.
 *
 * `kg` and `lb` are masses and convert freely; canonical kilograms are always
 * derived, never stored. `pins` is a machine stack position — a number with no
 * conversion to either, deliberately so: two gyms' stacks are not the same
 * weight, and nothing should be able to add a pin setting into a tonnage total
 * by accident. Treating it as a unit rather than a separate "scale" flag means
 * the type system carries that, and the same exercise can be logged in pins at
 * one gym and kilograms at another.
 */
export type LoadUnit = 'kg' | 'lb' | 'pins';

/** Units that represent a real mass and can therefore be summed. */
export const CONVERTIBLE_UNITS: readonly LoadUnit[] = ['kg', 'lb'];

export function isConvertible(unit: LoadUnit): boolean {
  return CONVERTIBLE_UNITS.includes(unit);
}

// --- working with intervals ---

/** A prescription with no upper bound is an AMRAP. There is no separate flag. */
export function isAmrap(reps: Interval): boolean {
  return reps[1] === null;
}

export function isScalar(i: Interval): boolean {
  return i[0] !== null && i[0] === i[1];
}

/** "6-8", "≥5", "8", "open" — how a prescription reads on a card. */
export function formatInterval(i: Interval | null, unit = ''): string {
  if (!i) return '—';
  const [lo, hi] = i;
  const u = unit ? unit : '';
  if (lo === null && hi === null) return 'open';
  if (hi === null) return `≥${lo}${u}`;
  if (lo === null) return `≤${hi}${u}`;
  return lo === hi ? `${lo}${u}` : `${lo}-${hi}${u}`;
}

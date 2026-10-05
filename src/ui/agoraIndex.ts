import type { LoadUnit } from '../model';
import type { Prefs } from './prefs';
import { PLATE_CHOICES } from './prefs';

/**
 * The words on Agora's index and on Settings: the live summary under each row.
 */

/** "2 templates", "1 template". */
export function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function libraryValue(count: number): string {
  return countOf(count, 'exercise');
}

/** "Phone · plates 2.5 kg, 5 lb": what Settings holds, at a glance. */
export function settingsSummary(prefs: Prefs): string {
  const name = prefs.deviceName || 'This device is not named';
  return `${name} · plates ${prefs.plateKg} kg, ${prefs.plateLb} lb`;
}

/** The plate increments as Segmented options; its values are strings. */
export function plateOptions(unit: Exclude<LoadUnit, 'pins'>): { value: string; label: string }[] {
  return PLATE_CHOICES[unit].map((n) => ({ value: String(n), label: String(n) }));
}

/** Which lifter section a row on the index opens at. */
export type LifterSection = 'bodyweight' | 'maxes' | 'records';

let pending: LifterSection | null = null;

/** Remembered by the index row that was tapped, taken by the Lifter page as it opens. */
export function aimAt(section: LifterSection): void {
  pending = section;
}

export function takeAim(): LifterSection | null {
  const aimed = pending;
  pending = null;
  return aimed;
}

/** What persistent storage reads as, for the settings row. */
export function persistenceText(persisted: boolean | null): {
  line: string;
  granted: boolean;
} {
  if (persisted === true) return { line: 'the browser will not clear the log', granted: true };
  if (persisted === false)
    return { line: 'the browser may clear the log under pressure', granted: false };
  return { line: 'checking', granted: false };
}

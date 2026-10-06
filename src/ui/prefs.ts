import type { LoadUnit } from '../model';
import type { Settings } from '../storage/store/store';

/**
 * The device's preferences, read from `Settings` with every gap filled. They
 * are optional there so settings saved before they existed still load; screens
 * read them through here and never see an absent one.
 */

export interface Prefs {
  deviceName: string;
  plateKg: number;
  plateLb: number;
  keepAwake: boolean;
  chime: boolean;
}

/** The increments the settings screen offers, per unit. Anything else saved is ignored. */
export const PLATE_CHOICES = {
  kg: [1.25, 2.5, 5],
  lb: [2.5, 5, 10],
} as const;

export const DEFAULT_PREFS: Prefs = {
  deviceName: '',
  plateKg: 2.5,
  plateLb: 5,
  keepAwake: false,
  chime: false,
};

type Stored = Partial<Pick<Settings, keyof Prefs>>;

/** Settings as stored, or a bare preferences record, to preferences. Junk falls back to the default. */
export function readPrefs(settings: Stored | null | undefined): Prefs {
  const s = settings ?? {};
  const plate = (value: unknown, choices: readonly number[], fallback: number) =>
    typeof value === 'number' && choices.includes(value) ? value : fallback;
  return {
    deviceName: typeof s.deviceName === 'string' ? s.deviceName.trim() : DEFAULT_PREFS.deviceName,
    plateKg: plate(s.plateKg, PLATE_CHOICES.kg, DEFAULT_PREFS.plateKg),
    plateLb: plate(s.plateLb, PLATE_CHOICES.lb, DEFAULT_PREFS.plateLb),
    keepAwake: s.keepAwake === true,
    chime: s.chime === true,
  };
}

/**
 * The plate step for a unit. Pins step by one: a stack position has no plates,
 * and the entry panel's - and + still need a step to take.
 */
export function plateStep(prefs: Prefs, unit: LoadUnit): number {
  if (unit === 'kg') return prefs.plateKg;
  if (unit === 'lb') return prefs.plateLb;
  return 1;
}

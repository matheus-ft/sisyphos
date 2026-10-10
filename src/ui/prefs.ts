import type { LoadUnit } from '../model';
import { CONFIG, MUSCLE_PRESET_NAMES } from '../metrics/definitions';
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
  /** The muscle-counting preset the Body view uses: a name in `muscle_roles.presets` of `definitions.json`. */
  muscleCounting: string;
}

/** The increments the settings screen offers to pick, per unit. */
export const PLATE_CHOICES = {
  kg: [1.25, 2.5, 5],
  lb: [2.5, 5, 10],
} as const;

/**
 * Any other increment is typed in: fractional plates make 0.5 kg, a gym with
 * nothing under 5 kg plates makes 10. Outside these bounds a step is a slip of
 * a finger rather than a pair of plates, and is not taken.
 */
export const PLATE_RANGE = {
  kg: { min: 0.25, max: 10 },
  lb: { min: 0.5, max: 20 },
} as const;

export type PlateUnit = keyof typeof PLATE_RANGE;

/** An increment, to the hundredth, if it is one `PLATE_RANGE` allows; else null. */
export function plateIncrement(value: unknown, unit: PlateUnit): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const step = Math.round(value * 100) / 100;
  const { min, max } = PLATE_RANGE[unit];
  return step >= min && step <= max ? step : null;
}

/** A typed increment ("0,5" too), or null when it is not one. */
export function parsePlate(text: string, unit: PlateUnit): number | null {
  const trimmed = text.trim().replace(',', '.');
  return trimmed === '' ? null : plateIncrement(Number(trimmed), unit);
}

export const DEFAULT_PREFS: Prefs = {
  deviceName: '',
  plateKg: 2.5,
  plateLb: 5,
  keepAwake: false,
  chime: false,
  muscleCounting: CONFIG.activeMuscleWeights,
};

type Stored = Partial<Pick<Settings, keyof Prefs>>;

/** Settings as stored, or a bare preferences record, to preferences. Junk falls back to the default. */
export function readPrefs(settings: Stored | null | undefined): Prefs {
  const s = settings ?? {};
  return {
    deviceName: typeof s.deviceName === 'string' ? s.deviceName.trim() : DEFAULT_PREFS.deviceName,
    plateKg: plateIncrement(s.plateKg, 'kg') ?? DEFAULT_PREFS.plateKg,
    plateLb: plateIncrement(s.plateLb, 'lb') ?? DEFAULT_PREFS.plateLb,
    keepAwake: s.keepAwake === true,
    chime: s.chime === true,
    muscleCounting:
      typeof s.muscleCounting === 'string' && MUSCLE_PRESET_NAMES.includes(s.muscleCounting)
        ? s.muscleCounting
        : DEFAULT_PREFS.muscleCounting,
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

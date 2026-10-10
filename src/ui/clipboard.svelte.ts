import type { SetCopy } from './session';

/**
 * A set copied from its menu, to paste into another: in any exercise, any
 * session, until the app is closed. Kept here rather than only on the phone's
 * clipboard, which a web app cannot read back without asking each time.
 */
export const clipboard = $state<{ copy: SetCopy | null; text: string }>({ copy: null, text: '' });

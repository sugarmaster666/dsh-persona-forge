/**
 * The host routes' paths, in one place.
 *
 * Only the host half imports this module. The browser half is a plain
 * CommonJS module loaded through the shell's lazy module table, so it cannot
 * import ESM; it repeats the prefix in `lib/client.js` instead. `check.mjs`
 * asserts the two agree, so the duplication cannot drift silently.
 *
 * @module dsh-persona-forge/shared/protocol
 */

/** Mount prefix of every route this plugin owns. */
export const PREFIX = '/persona-forge'

/** Read the effective character-card catalog. */
export const CARDS_ENDPOINT = `${PREFIX}/cards`

/** Rewrite one draft into a persona voice. */
export const REWRITE_ENDPOINT = `${PREFIX}/rewrite`

/** Create or replace one user-owned character card. */
export const CARD_SAVE_ENDPOINT = `${PREFIX}/cards/save`

/** Delete one user-owned character card. */
export const CARD_DELETE_ENDPOINT = `${PREFIX}/cards/delete`

/**
 * Replace one user card with the bundled card of the same id, discarding local
 * edits. The escape hatch for a copy frozen at an older bundled version.
 */
export const CARD_RESET_ENDPOINT = `${PREFIX}/cards/reset`

/**
 * Compare every user card against the bundled card of the same id and report
 * only the ones that actually differ.
 *
 * On demand rather than always-on: a list that permanently shows a "restore"
 * button on every row is noise when most rows match the bundle, and walking a
 * long list row by row is worse. One action answers the only question worth
 * asking — which of my cards have drifted from the defaults?
 */
export const CARD_DIFF_ENDPOINT = `${PREFIX}/cards/diff`

/** Open (creating if needed) the user card directory in the OS file manager. */
export const REVEAL_ENDPOINT = `${PREFIX}/reveal`

/**
 * Turn a rough character idea into a filled-in card, using the session's model.
 *
 * The result is only ever a PREFILL for the card form: it is returned to the
 * browser and never written to disk by this route. The user reviews it, edits
 * it if they want, and saves it themselves through the existing save route —
 * so a bad generation costs a reload, not a corrupted card catalog.
 */
export const CARD_DRAFT_ENDPOINT = `${PREFIX}/cards/draft`

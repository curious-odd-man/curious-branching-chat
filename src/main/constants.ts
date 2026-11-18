/** Times of the main process (code review section 9). The sync engine has its own in `sync/syncTypes.ts`. */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** ADR-003 Q-07: image files that nothing uses are removed after this time. */
export const UNUSED_BLOB_MAX_AGE_MS = 7 * DAY_MS
/** Opened copies of attachments older than this are removed at start (a program may still hold a newer one). */
export const OPENED_COPY_MAX_AGE_MS = 7 * DAY_MS
/** FR-097: the first automatic update check after the start, then the interval. */
export const UPDATE_FIRST_CHECK_MS = 20_000
export const UPDATE_CHECK_INTERVAL_MS = 6 * HOUR_MS
/** FR-207: the first check for the daily backup after the start. */
export const BACKUP_FIRST_CHECK_MS = MINUTE_MS
/** Sync: each conversation folder is scanned this often, also without a watch event. */
export const SCAN_INTERVAL_MS = 5 * MINUTE_MS
/** Sync: a second scan after a watch event, after the stable time, for files that were still growing. */
export const SCAN_AFTER_STABLE_MS = 500

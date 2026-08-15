// mobile/db/testDataFilter.ts
// One shared SQL fragment for every query that reads `trips` or
// `saved_stations` (both carry is_test as of schema v5) -- dev-mode builds
// see everything, including test data; production builds exclude it. See
// docs/data-layer.md's "Dev/prod data separation".
import { IS_DEV_MODE } from '../lib/devMode';

/** `prefix` is whatever the query aliases the trips/saved_stations table
 *  as -- e.g. 't.' for `FROM legs l JOIN trips t ...`, '' for an unaliased
 *  direct `FROM trips ...`. Call sites in this codebase aren't consistent
 *  about aliasing, so this takes it as a parameter rather than assuming
 *  one. Returns an empty string in dev mode (no filter at all). */
export function testDataFilterSql(prefix = ''): string {
    return IS_DEV_MODE ? '' : `AND ${prefix}is_test = 0`;
}

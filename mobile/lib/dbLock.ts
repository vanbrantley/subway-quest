// mobile/lib/dbLock.ts
//
// A minimal async mutex, shared between SyncContext's on-mount sync and
// RehydrationGate's wipe-check/rehydrate. Both open SQLite transactions
// independently on mount, and SyncProvider sits ABOVE RehydrationGate in
// the component tree (app/_layout.tsx) with no awareness of it -- so
// nothing previously stopped their two withTransactionAsync calls from
// overlapping on the same connection. expo-sqlite doesn't support that:
// confirmed on-device, a genuinely fresh account (rehydration actually
// running, not a no-op) hit "cannot start a transaction within a
// transaction" followed by a mismatched rollback, leaving the local
// database in a corrupted state. This lock makes every transaction-opening
// call from either system wait its turn instead.
//
// Deliberately NOT wrapping every transaction in the app (e.g. saveStation/
// commitTrip/deleteTrip) -- those are all user-action-triggered, and
// RehydrationGate already structurally blocks the UI that could trigger
// them (LogTripFAB, the whole tab stack) until its own effect finishes, so
// they can't race with rehydration/wipe. Sync-on-mount is the one thing
// that fires with no such gate.
let queue: Promise<void> = Promise.resolve();

export function withDbLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.then(
        () => undefined,
        () => undefined // keep the chain alive even if fn threw, or every later caller deadlocks on a rejected promise
    );
    return run;
}

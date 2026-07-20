// mobile/db/rehydrate_tests.ts
// Run: npx ts-node db/rehydrate_tests.ts
import { planRehydration, type RemoteEventRow } from './rehydrate-plan';

let failures = 0;
function check(desc: string, cond: boolean) {
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${desc}`);
    if (!cond) failures++;
}

function ev(overrides: Partial<RemoteEventRow>): RemoteEventRow {
    return {
        event_id: overrides.event_id ?? `e${Math.random()}`,
        event_type: overrides.event_type!,
        event_domain: 'trip',
        event_version: overrides.event_version ?? 1,
        occurred_at: overrides.occurred_at ?? '2026-07-10T09:00:00Z',
        recorded_at: overrides.recorded_at ?? '2026-07-11T14:00:00Z',
        device_id: overrides.device_id ?? 'dev1',
        user_id: overrides.user_id ?? 'user1',
        trip_id: overrides.trip_id ?? 'trip1',
        leg_id: overrides.leg_id ?? null,
        payload: overrides.payload ?? {},
    };
}

// --- The required test: a deleted trip never materializes ---
{
    const events = [
        ev({ event_type: 'trip_started', trip_id: 'tripA', payload: { origin_station_id: 'L08' } }),
        ev({ event_type: 'leg_boarded', trip_id: 'tripA', leg_id: 'legA1', payload: { station_id: 'L08', route_id: 'L', sequence: 1 } }),
        ev({ event_type: 'leg_alighted', trip_id: 'tripA', leg_id: 'legA1', payload: { station_id: 'L03' } }),
        ev({ event_type: 'trip_ended', trip_id: 'tripA', payload: { destination_station_id: 'L03' } }),
        ev({ event_type: 'trip_deleted', trip_id: 'tripA', payload: { reason: 'test' } }),
    ];
    const plan = planRehydration(events);
    check('deleted trip is not in restore list', !plan.restore.some((t) => t.tripId === 'tripA'));
    check('deleted trip is in skippedDeleted', plan.skippedDeleted.includes('tripA'));
    check('restore list is empty', plan.restore.length === 0);
}

// --- A live trip restores, with correct leg order despite out-of-order remote rows ---
{
    const events = [
        ev({ event_type: 'trip_started', trip_id: 'tripB', payload: { origin_station_id: 'F26' } }),
        ev({ event_type: 'leg_boarded', trip_id: 'tripB', leg_id: 'legB2', payload: { station_id: 'A32', route_id: 'E', sequence: 2 } }),
        ev({ event_type: 'leg_alighted', trip_id: 'tripB', leg_id: 'legB2', payload: { station_id: 'F11' } }),
        ev({ event_type: 'leg_boarded', trip_id: 'tripB', leg_id: 'legB1', payload: { station_id: 'F26', route_id: 'F', sequence: 1 } }),
        ev({ event_type: 'leg_alighted', trip_id: 'tripB', leg_id: 'legB1', payload: { station_id: 'D20' } }),
        ev({ event_type: 'trip_ended', trip_id: 'tripB', payload: { destination_station_id: 'F11' } }),
    ];
    const plan = planRehydration(events);
    const trip = plan.restore.find((t) => t.tripId === 'tripB');
    check('non-deleted trip restores', !!trip);
    check('leg order correct (sequence 1 first) despite arrival order', trip?.draft.legs[0].routeId === 'F');
    check('leg order correct (sequence 2 second) despite arrival order', trip?.draft.legs[1].routeId === 'E');
}

// --- Mixed batch: only the live trip restores, the deleted one is excluded ---
{
    const deleted = [
        ev({ event_type: 'trip_started', trip_id: 'tripC', payload: { origin_station_id: 'X1' } }),
        ev({ event_type: 'leg_boarded', trip_id: 'tripC', leg_id: 'legC1', payload: { station_id: 'X1', route_id: 'X', sequence: 1 } }),
        ev({ event_type: 'leg_alighted', trip_id: 'tripC', leg_id: 'legC1', payload: { station_id: 'X2' } }),
        ev({ event_type: 'trip_ended', trip_id: 'tripC', payload: { destination_station_id: 'X2' } }),
        ev({ event_type: 'trip_deleted', trip_id: 'tripC', payload: {} }),
    ];
    const live = [
        ev({ event_type: 'trip_started', trip_id: 'tripD', payload: { origin_station_id: 'Y1' } }),
        ev({ event_type: 'leg_boarded', trip_id: 'tripD', leg_id: 'legD1', payload: { station_id: 'Y1', route_id: 'Y', sequence: 1 } }),
        ev({ event_type: 'leg_alighted', trip_id: 'tripD', leg_id: 'legD1', payload: { station_id: 'Y2' } }),
        ev({ event_type: 'trip_ended', trip_id: 'tripD', payload: { destination_station_id: 'Y2' } }),
    ];
    const plan = planRehydration([...deleted, ...live]);
    check('only the live trip restores', plan.restore.length === 1 && plan.restore[0].tripId === 'tripD');
    check('the deleted trip is correctly excluded', plan.skippedDeleted.includes('tripC'));
}

// --- Incomplete event set is skipped, not crashed ---
{
    const events = [
        ev({ event_type: 'trip_started', trip_id: 'tripE', payload: { origin_station_id: 'Z1' } }),
        ev({ event_type: 'leg_boarded', trip_id: 'tripE', leg_id: 'legE1', payload: { station_id: 'Z1', route_id: 'Z', sequence: 1 } }),
        // no leg_alighted, no trip_ended
    ];
    const plan = planRehydration(events);
    check('incomplete trip skipped, not restored', plan.restore.length === 0);
    check('incomplete trip flagged', plan.skippedIncomplete.includes('tripE'));
}

console.log();
if (failures > 0) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
else { console.log('All checks passed.'); }
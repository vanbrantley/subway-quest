// mobile/components/profile/TripHistoryList.tsx
// Trip history, filterable by time range independently of FavoritesCharts.
// Entirely client-side -- trips are already loaded in full with startedAt by
// the Profile page. Pagination/count-header behavior lives in the shared
// PaginatedList; this component owns only the time-range filtering on top.
// The filter renders via PaginatedList's headerExtra slot, so it appears
// under this section's own "Trip history (N)" header rather than trailing
// off whatever section happens to render above it.
import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { rangeToStartDate, localMidnightToIsoUtc, type TimeRange } from '../../lib/dateMath';
import type { TripHistoryEntry } from '../../db/trips';
import { TripHistoryRow } from '../ui/TripHistoryRow';
import { TimeRangeFilter } from '../ui/TimeRangeFilter';
import { PaginatedList } from '../ui/PaginatedList';

function rangeLabel(range: TimeRange): string {
    return range === '30d' ? 'the last 30 days' : range === '7d' ? 'the last week' : '';
}

type Props = { trips: TripHistoryEntry[] };

export function TripHistoryList({ trips }: Props) {
    const [range, setRange] = useState<TimeRange>('all');

    const filtered = useMemo(() => {
        const cutoff = rangeToStartDate(range);
        if (cutoff === null) return trips;
        const cutoffIso = localMidnightToIsoUtc(cutoff);
        return trips.filter((t) => t.startedAt >= cutoffIso);
    }, [trips, range]);

    return (
        <PaginatedList
            title="Trip history"
            items={filtered}
            renderItem={(t) => <TripHistoryRow {...t} />}
            keyExtractor={(t) => t.tripId}
            itemNoun="trips"
            emptyText={trips.length === 0 ? 'No trips logged yet.' : `No trips in ${rangeLabel(range)}.`}
            headerStyle={styles.sectionSpacing}
            headerExtra={<TimeRangeFilter value={range} onChange={setRange} />}
            resetKey={range}
        />
    );
}

const styles = StyleSheet.create({
    sectionSpacing: { marginTop: 20 },
});

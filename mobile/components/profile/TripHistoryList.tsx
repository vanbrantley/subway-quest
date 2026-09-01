// mobile/components/profile/TripHistoryList.tsx
// Trip history: collapsed to 5 by default with progressive "Show more" /
// "Show less" disclosure (not infinite scroll -- keeps scroll position
// predictable and stays simple to make accessible), filterable by time
// range independently of FavoritesCharts. Entirely client-side -- trips are
// already loaded in full with startedAt by the Profile page.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { rangeToStartDate, localMidnightToIsoUtc, type TimeRange } from '../../lib/dateMath';
import type { TripHistoryEntry } from '../../db/trips';
import { TripHistoryRow } from '../ui/TripHistoryRow';
import { TimeRangeFilter } from '../ui/TimeRangeFilter';
import { SectionHeader } from '../ui/SectionHeader';

const DEFAULT_VISIBLE = 5;
const REVEAL_BATCH = 10;

function rangeLabel(range: TimeRange): string {
    return range === '30d' ? 'the last 30 days' : range === '7d' ? 'the last week' : '';
}

type Props = { trips: TripHistoryEntry[] };

export function TripHistoryList({ trips }: Props) {
    const [range, setRange] = useState<TimeRange>('all');
    const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE);

    // Switching the filter with a stale large reveal count would either leave
    // the list looking wrong (way more revealed than the new filter has) or
    // silently keep a huge count around for next time -- always resets to
    // the default collapsed view instead.
    useEffect(() => {
        setVisibleCount(DEFAULT_VISIBLE);
    }, [range]);

    const filtered = useMemo(() => {
        const cutoff = rangeToStartDate(range);
        if (cutoff === null) return trips;
        const cutoffIso = localMidnightToIsoUtc(cutoff);
        return trips.filter((t) => t.startedAt >= cutoffIso);
    }, [trips, range]);

    const visible = filtered.slice(0, visibleCount);
    const remaining = filtered.length - visibleCount;

    return (
        <View>
            <TimeRangeFilter value={range} onChange={setRange} />
            <SectionHeader title={`Trip history (${filtered.length})`} style={styles.sectionSpacing} />

            {filtered.length === 0 ? (
                <Text style={styles.emptyText}>
                    {trips.length === 0 ? 'No trips logged yet.' : `No trips in ${rangeLabel(range)}.`}
                </Text>
            ) : (
                <>
                    {visible.map((t) => <TripHistoryRow key={t.tripId} {...t} />)}
                    {(remaining > 0 || visibleCount > DEFAULT_VISIBLE) && (
                        <View style={styles.footer}>
                            {remaining > 0 && (
                                <Pressable
                                    onPress={() => setVisibleCount((c) => Math.min(filtered.length, c + REVEAL_BATCH))}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Show ${Math.min(REVEAL_BATCH, remaining)} more trips, ${filtered.length} total`}
                                >
                                    <Text style={styles.footerLink}>
                                        {remaining <= REVEAL_BATCH ? `Show all remaining (${remaining})` : `Show ${REVEAL_BATCH} more`}
                                    </Text>
                                </Pressable>
                            )}
                            {visibleCount > DEFAULT_VISIBLE && (
                                <Pressable
                                    onPress={() => setVisibleCount(DEFAULT_VISIBLE)}
                                    accessibilityRole="button"
                                    accessibilityLabel="Show less trip history"
                                >
                                    <Text style={styles.footerLink}>Show less</Text>
                                </Pressable>
                            )}
                        </View>
                    )}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    sectionSpacing: { marginTop: 20 },
    emptyText: { fontSize: 14, color: '#999', fontStyle: 'italic' },
    footer: { flexDirection: 'row', gap: 20, marginTop: 8 },
    footerLink: { fontSize: 13, fontWeight: '700', color: '#2e9e52' },
});

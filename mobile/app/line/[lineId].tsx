// mobile/app/line/[lineId].tsx (root-level, shared canonical page — reached
// from the map's preview, a station page, or eventually the Search tab's
// line grid — same pattern as station/[stationId].tsx and the existing
// achievements/[questId].tsx/trip.tsx. Never nested under one tab's own
// stack; see status.md's router-rules note on why that breaks navigation.)
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '../../contexts/DatabaseContext';
import { useUserId } from '../../contexts/AuthContext';
import { getOrCreateDeviceId } from '../../lib/device';
import { writeProductEvent } from '../../db/projection';
import { getAllStationStatuses, type StationStatus } from '../../db/stations';
import { getLineVisitHistory, type TripHistoryEntry } from '../../db/trips';
import { getLineStationItems, getShuttleStationItems, getShuttleName } from '../../lib/subwayData';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { LineTriviaFact } from '../../components/trivia/LineTriviaFact';
import { RouteIcon } from '../../components/ui/RouteIcon';
import { StationRow } from '../../components/ui/StationRow';
import { TripHistoryRow } from '../../components/ui/TripHistoryRow';
import { PaginatedList } from '../../components/ui/PaginatedList';
import { TAB_BAR_HEIGHT } from '../../components/CustomTabBar';

function BoroughHeader({ label }: { label: string }) {
    return <Text style={styles.boroughLabel}>{label}</Text>;
}

function GroupHeader({
    label, routeId, onPress,
}: {
    label: string;
    routeId?: string;
    onPress: (routeId: string) => void;
}) {
    if (routeId) {
        // Only a group that's itself a separately-navigable line (the S
        // overview page's shuttle groups) gets a tappable header — a real
        // branch tail's label stays plain text, same as today.
        return (
            <Pressable style={styles.groupLabelRow} onPress={() => onPress(routeId)}>
                <Text style={styles.groupLabel}>{label}</Text>
                <Ionicons name="chevron-forward" size={14} color="#888" />
            </Pressable>
        );
    }
    return <Text style={[styles.groupLabel, styles.groupLabelSpacing]}>{label}</Text>;
}

export default function LineScreen() {
    const { lineId } = useLocalSearchParams<{ lineId: string }>();
    const db = useDb();
    const userId = useUserId();
    const insets = useSafeAreaInsets();
    const [statuses, setStatuses] = useState<Record<string, StationStatus> | null>(null);
    const [visits, setVisits] = useState<TripHistoryEntry[] | null>(null);

    // 'S' isn't a branching route with a shared trunk -- it's three separate,
    // unrelated shuttles sharing one display icon. getShuttleStationItems()
    // gives each its own real name instead of getLineStationItems' generic
    // trunk/tail split (built for real geographic forks), reusing the same
    // flat LineStationItem[] shape so nothing else on this page changes.
    const items = useMemo(
        () => (lineId === 'S' ? getShuttleStationItems() : getLineStationItems(lineId)),
        [lineId]
    );
    // A stopId can legitimately appear twice in `items` (a real junction a
    // rider passes through on either branch, e.g. the 5's East 180 St) — it
    // still gets its own row under each branch, but it's one physical
    // station, so progress counting dedupes by stopId here even though the
    // render below doesn't.
    const uniqueStopIds = useMemo(
        () => [...new Set(items.filter((item) => item.kind === 'station').map((item) => item.stopId))],
        [items]
    );
    const totalStations = uniqueStopIds.length;
    // Only the three real shuttles (FS/GS/H) resolve to a name here — the
    // combined 'S' overview page itself gets null, same as every non-shuttle
    // line, since its icon is already the whole story there.
    const shuttleName = useMemo(() => getShuttleName(lineId), [lineId]);

    useEffect(() => {
        (async () => {
            const [allStatuses, visitHistory] = await Promise.all([
                getAllStationStatuses(db, userId),
                getLineVisitHistory(db, userId, lineId),
            ]);
            setStatuses(allStatuses);
            setVisits(visitHistory);
            const deviceId = await getOrCreateDeviceId();
            await writeProductEvent(db, 'route_detail_opened', { route_id: lineId }, { deviceId, userId });
        })();
    }, [db, userId, lineId]);

    const visitedCount = useMemo(() => {
        if (!statuses) return 0;
        return uniqueStopIds.filter((stopId) => statuses[stopId]?.visited).length;
    }, [statuses, uniqueStopIds]);

    function goToStation(stopId: string) {
        router.push(`/station/${stopId}`);
    }

    function goToShuttleLine(routeId: string) {
        router.push(`/line/${routeId}`);
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable onPress={() => router.back()} accessibilityLabel="Back">
                    <Ionicons name="chevron-back" size={26} color="#111" />
                </Pressable>
            </View>

            {!statuses ? (
                <View style={styles.centered}><ActivityIndicator /></View>
            ) : (
                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 20 }]}>
                    <View style={styles.lineHeading}>
                        <RouteIcon routeId={lineId} size={64} onPress={null} />
                        {shuttleName && <Text style={styles.shuttleName}>{shuttleName}</Text>}
                    </View>
                    <ProgressBar current={visitedCount} target={totalStations} label="Stations visited" />

                    {lineId !== 'S' && <LineTriviaFact routeId={lineId} />}

                    {items.map((item, i) => {
                        if (item.kind === 'station') {
                            // Keyed by position, not stopId — a station can
                            // legitimately appear twice (e.g. the 5's East
                            // 180 St, a real junction both its branches pass
                            // through), and forcing stopId-uniqueness would
                            // mean silently dropping one of two real rows.
                            return (
                                <StationRow
                                    key={`s-${i}`}
                                    stopId={item.stopId}
                                    visited={statuses[item.stopId]?.visited ?? false}
                                    onPress={() => goToStation(item.stopId)}
                                />
                            );
                        }
                        if (item.kind === 'groupHeader') {
                            return <GroupHeader key={`g-${i}`} label={item.label} routeId={item.routeId} onPress={goToShuttleLine} />;
                        }
                        return <BoroughHeader key={`b-${i}`} label={item.label} />;
                    })}

                    <View style={styles.visitHistorySection}>
                        {visits === null ? (
                            <ActivityIndicator />
                        ) : (
                            <PaginatedList
                                title="Visit history"
                                items={visits}
                                renderItem={(v) => <TripHistoryRow {...v} />}
                                keyExtractor={(v) => v.tripId}
                                itemNoun="visits"
                                emptyText="Not ridden yet."
                            />
                        )}
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    content: { padding: 20 },
    lineHeading: { alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 16 },
    shuttleName: { fontSize: 15, fontWeight: '600', color: '#444' },
    groupLabel: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3 },
    groupLabelSpacing: { marginTop: 16, marginBottom: 4 },
    groupLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 16, marginBottom: 4 },
    boroughLabel: { fontSize: 12, fontWeight: '600', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 12, marginBottom: 4 },
    visitHistorySection: { marginTop: 24 },
});

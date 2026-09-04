// mobile/app/borough/[boroughId].tsx (root-level, shared canonical page —
// reached from the Search tab's "Browse by borough" section, the Profile
// tab's "By borough" bars, and a Neighborhood page's back-navigation — same
// pattern as line/[lineId].tsx and station/[stationId].tsx. Never nested
// under one tab's own stack; see status.md's router-rules note on why that
// breaks navigation.)
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
import { getBoroughVisitHistory, type TripHistoryEntry } from '../../db/trips';
import { getBoroughName, getBoroughStationItems, getNeighborhoodsForBorough, getStationsByNeighborhood, getStation } from '../../lib/subwayData';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { StationLinesRow } from '../../components/ui/StationLinesRow';
import { TripHistoryRow } from '../../components/ui/TripHistoryRow';
import { PaginatedList } from '../../components/ui/PaginatedList';
import { TAB_BAR_HEIGHT } from '../../components/CustomTabBar';

function NeighborhoodHeader({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <Pressable style={styles.neighborhoodHeaderRow} onPress={onPress}>
            <Text style={styles.neighborhoodHeaderLabel}>{label}</Text>
            <Ionicons name="chevron-forward" size={14} color="#aaa" />
        </Pressable>
    );
}

function NeighborhoodRow({
    name, visited, total, onPress,
}: {
    name: string;
    visited: number;
    total: number;
    onPress: () => void;
}) {
    return (
        <Pressable style={styles.neighborhoodRow} onPress={onPress}>
            <Text style={styles.neighborhoodRowText} numberOfLines={1}>{name}</Text>
            <Text style={styles.neighborhoodRowCount}>{visited}/{total}</Text>
            <Ionicons name="chevron-forward" size={16} color="#ccc" />
        </Pressable>
    );
}

export default function BoroughScreen() {
    const { boroughId } = useLocalSearchParams<{ boroughId: string }>();
    const db = useDb();
    const userId = useUserId();
    const insets = useSafeAreaInsets();
    const [statuses, setStatuses] = useState<Record<string, StationStatus> | null>(null);
    const [visits, setVisits] = useState<TripHistoryEntry[] | null>(null);

    const items = useMemo(() => getBoroughStationItems(boroughId), [boroughId]);
    const stopIds = useMemo(
        () => items.filter((item) => item.kind === 'station').map((item) => item.stopId),
        [items]
    );
    const totalStations = stopIds.length;
    const neighborhoods = useMemo(() => getNeighborhoodsForBorough(boroughId), [boroughId]);

    useEffect(() => {
        (async () => {
            const [allStatuses, visitHistory] = await Promise.all([
                getAllStationStatuses(db, userId),
                getBoroughVisitHistory(db, userId, boroughId),
            ]);
            setStatuses(allStatuses);
            setVisits(visitHistory);
            const deviceId = await getOrCreateDeviceId();
            await writeProductEvent(db, 'borough_detail_opened', { borough: boroughId }, { deviceId, userId });
        })();
    }, [db, userId, boroughId]);

    const visitedCount = useMemo(() => {
        if (!statuses) return 0;
        return stopIds.filter((stopId) => statuses[stopId]?.visited).length;
    }, [statuses, stopIds]);

    function goToStation(stopId: string) {
        router.push(`/station/${stopId}`);
    }

    function goToNeighborhood(name: string) {
        router.push(`/neighborhood/${boroughId}/${encodeURIComponent(name)}`);
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
                    <Text style={styles.heading}>{getBoroughName(boroughId)}</Text>
                    <ProgressBar current={visitedCount} target={totalStations} label="Stations visited" />

                    {neighborhoods.length > 0 && (
                        <CollapsibleSection title="Neighborhoods" count={neighborhoods.length} defaultExpanded={false}>
                            {neighborhoods.map((name) => {
                                const stationsHere = getStationsByNeighborhood(boroughId, name);
                                const visitedHere = stationsHere.filter((s) => statuses[s.stop_id]?.visited).length;
                                return (
                                    <NeighborhoodRow
                                        key={name}
                                        name={name}
                                        visited={visitedHere}
                                        total={stationsHere.length}
                                        onPress={() => goToNeighborhood(name)}
                                    />
                                );
                            })}
                        </CollapsibleSection>
                    )}

                    <CollapsibleSection title="Stations" count={totalStations}>
                        {items.map((item, i) => {
                            if (item.kind === 'station') {
                                return (
                                    <StationLinesRow
                                        key={`s-${i}`}
                                        stopId={item.stopId}
                                        routeIds={getStation(item.stopId)?.daytime_routes ?? []}
                                        visited={statuses[item.stopId]?.visited ?? false}
                                        onPress={() => goToStation(item.stopId)}
                                    />
                                );
                            }
                            return (
                                <NeighborhoodHeader
                                    key={`n-${i}`}
                                    label={item.label}
                                    onPress={() => goToNeighborhood(item.label)}
                                />
                            );
                        })}
                    </CollapsibleSection>

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
                                emptyText="Not visited yet."
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
    heading: { fontSize: 26, fontWeight: '700', textAlign: 'center', marginTop: 12, marginBottom: 16 },
    neighborhoodRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
    neighborhoodRowText: { flex: 1, fontSize: 15, color: '#222' },
    neighborhoodRowCount: { fontSize: 13, color: '#999' },
    neighborhoodHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, marginBottom: 4 },
    neighborhoodHeaderLabel: { fontSize: 12, fontWeight: '600', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.3 },
    visitHistorySection: { marginTop: 24 },
});

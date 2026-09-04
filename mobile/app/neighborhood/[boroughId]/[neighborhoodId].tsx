// mobile/app/neighborhood/[boroughId]/[neighborhoodId].tsx (root-level,
// shared canonical page — reached from a Borough page's "Neighborhoods"
// section and Search's neighborhood matches — same pattern as
// line/[lineId].tsx and station/[stationId].tsx. Never nested under one
// tab's own stack; see status.md's router-rules note on why that breaks
// navigation. Nested under boroughId rather than a flat /neighborhood/[name]
// route: neighborhood names are only guaranteed unique within one borough,
// not city-wide.)
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '../../../contexts/DatabaseContext';
import { useUserId } from '../../../contexts/AuthContext';
import { getOrCreateDeviceId } from '../../../lib/device';
import { writeProductEvent } from '../../../db/projection';
import { getAllStationStatuses, type StationStatus } from '../../../db/stations';
import { getNeighborhoodVisitHistory, type TripHistoryEntry } from '../../../db/trips';
import { getBoroughName, getStationsByNeighborhood } from '../../../lib/subwayData';
import { ProgressBar } from '../../../components/ui/ProgressBar';
import { CollapsibleSection } from '../../../components/ui/CollapsibleSection';
import { StationLinesRow } from '../../../components/ui/StationLinesRow';
import { TripHistoryRow } from '../../../components/ui/TripHistoryRow';
import { PaginatedList } from '../../../components/ui/PaginatedList';
import { TAB_BAR_HEIGHT } from '../../../components/CustomTabBar';

export default function NeighborhoodScreen() {
    const { boroughId, neighborhoodId } = useLocalSearchParams<{ boroughId: string; neighborhoodId: string }>();
    const neighborhoodName = decodeURIComponent(neighborhoodId);
    const db = useDb();
    const userId = useUserId();
    const insets = useSafeAreaInsets();
    const [statuses, setStatuses] = useState<Record<string, StationStatus> | null>(null);
    const [visits, setVisits] = useState<TripHistoryEntry[] | null>(null);

    const stations = useMemo(
        () => getStationsByNeighborhood(boroughId, neighborhoodName).sort((a, b) => a.name.localeCompare(b.name)),
        [boroughId, neighborhoodName]
    );
    const totalStations = stations.length;

    useEffect(() => {
        (async () => {
            const [allStatuses, visitHistory] = await Promise.all([
                getAllStationStatuses(db, userId),
                getNeighborhoodVisitHistory(db, userId, boroughId, neighborhoodName),
            ]);
            setStatuses(allStatuses);
            setVisits(visitHistory);
            const deviceId = await getOrCreateDeviceId();
            await writeProductEvent(db, 'neighborhood_detail_opened', { borough: boroughId, neighborhood: neighborhoodName }, { deviceId, userId });
        })();
    }, [db, userId, boroughId, neighborhoodName]);

    const visitedCount = useMemo(() => {
        if (!statuses) return 0;
        return stations.filter((s) => statuses[s.stop_id]?.visited).length;
    }, [statuses, stations]);

    function goToStation(stopId: string) {
        router.push(`/station/${stopId}`);
    }

    function goToBorough() {
        router.push(`/borough/${boroughId}`);
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
                    <Text style={styles.heading} numberOfLines={2}>{neighborhoodName}</Text>
                    <Pressable onPress={goToBorough} hitSlop={6}>
                        <Text style={styles.borough}>{getBoroughName(boroughId)}</Text>
                    </Pressable>
                    <ProgressBar current={visitedCount} target={totalStations} label="Stations visited" />

                    <CollapsibleSection title="Stations" count={totalStations}>
                        {stations.map((s) => (
                            <StationLinesRow
                                key={s.stop_id}
                                stopId={s.stop_id}
                                routeIds={s.daytime_routes}
                                visited={statuses[s.stop_id]?.visited ?? false}
                                onPress={() => goToStation(s.stop_id)}
                            />
                        ))}
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
    heading: { fontSize: 26, fontWeight: '700', textAlign: 'center', marginTop: 12, marginBottom: 4 },
    borough: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 16 },
    visitHistorySection: { marginTop: 24 },
});

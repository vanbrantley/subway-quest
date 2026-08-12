// mobile/app/station/[stationId].tsx (root-level, shared canonical page —
// reached from the Map tab's preview modal, a Line page's station list, and
// eventually Search results — same pattern as line/[lineId].tsx. Never
// nested under one tab's own stack; see status.md's router-rules note.)
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '../../contexts/DatabaseContext';
import { useUserId } from '../../contexts/AuthContext';
import { useSyncEngine } from '../../contexts/SyncContext';
import { getOrCreateDeviceId } from '../../lib/device';
import { saveStation, unsaveStation, writeProductEvent } from '../../db/projection';
import { getStationStatus, getStationVisitHistory, type StationStatus, type StationVisit } from '../../db/stations';
import { StationQuestsList } from '../../components/quests/StationQuestsList';
import { RouteIcon } from '../../components/ui/RouteIcon';
import { TripHistoryRow } from '../../components/ui/TripHistoryRow';
import {
    getStation, getBoroughName, getComplexId,
    isNavigableRoute, normalizeRouteIdForIcon, getOtherComplexRoutes,
} from '../../lib/subwayData';

export default function StationScreen() {
    const { stationId } = useLocalSearchParams<{ stationId: string }>();
    const db = useDb();
    const userId = useUserId();
    const insets = useSafeAreaInsets();
    const { triggerSync } = useSyncEngine();

    const [status, setStatus] = useState<StationStatus | null>(null);
    const [visits, setVisits] = useState<StationVisit[] | null>(null);
    const [saving, setSaving] = useState(false);

    const station = getStation(stationId);
    const ownRoutes = station?.daytime_routes ?? [];
    const transferRoutes = getOtherComplexRoutes(stationId);
    const complexId = getComplexId(stationId);

    useEffect(() => {
        (async () => {
            setStatus(await getStationStatus(db, userId, stationId));
            setVisits(await getStationVisitHistory(db, userId, stationId));
            const deviceId = await getOrCreateDeviceId();
            await writeProductEvent(db, 'station_detail_opened', { station_id: stationId }, { deviceId, userId });
        })();
    }, [db, userId, stationId]);

    function goToLine(routeId: string) {
        const target = normalizeRouteIdForIcon(routeId);
        if (!isNavigableRoute(target)) return;
        router.push(`/line/${target}`);
    }

    async function toggleSave() {
        if (!status || saving) return;
        setSaving(true);
        try {
            const deviceId = await getOrCreateDeviceId();
            const ctx = { deviceId, userId };
            if (status.saved) {
                await unsaveStation(db, stationId, ctx);
            } else {
                await saveStation(db, stationId, ctx);
            }
            setStatus({ ...status, saved: !status.saved });
            triggerSync();
        } finally {
            setSaving(false);
        }
    }

    if (!station) {
        return (
            <View style={styles.centered}>
                <Text style={styles.label}>Station not found.</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable onPress={() => router.back()} accessibilityLabel="Back">
                    <Ionicons name="chevron-back" size={26} color="#111" />
                </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.stationNameHeading} numberOfLines={2}>{station.name}</Text>
                <Text style={styles.borough}>{getBoroughName(station.borough)}</Text>

                <View style={styles.groupSection}>
                    <Text style={styles.groupLabel}>This platform</Text>
                    <View style={styles.iconRow}>
                        {ownRoutes.map((r) => (
                            <RouteIcon key={r} routeId={r} onPress={isNavigableRoute(normalizeRouteIdForIcon(r)) ? () => goToLine(r) : null} />
                        ))}
                    </View>

                    {status === null ? (
                        <ActivityIndicator style={styles.statusLoading} />
                    ) : (
                        <View style={styles.statusRow}>
                            <View style={[styles.statusBadge, status.visited ? styles.statusBadgeVisited : styles.statusBadgeUnvisited]}>
                                <Ionicons name={status.visited ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={status.visited ? '#3d9a5c' : '#999'} />
                                <Text style={[styles.statusBadgeText, status.visited ? styles.statusBadgeTextVisited : styles.statusBadgeTextUnvisited]}>
                                    {status.visited ? 'Visited' : 'Not visited'}
                                </Text>
                            </View>
                            <Pressable style={[styles.saveButton, status.saved && styles.saveButtonActive]} onPress={toggleSave} disabled={saving}>
                                <Ionicons name={status.saved ? 'bookmark' : 'bookmark-outline'} size={16} color={status.saved ? '#fff' : '#444'} />
                                <Text style={[styles.saveButtonText, status.saved && styles.saveButtonTextActive]}>
                                    {status.saved ? 'Saved' : 'Save'}
                                </Text>
                            </Pressable>
                        </View>
                    )}
                </View>

                {transferRoutes.length > 0 && (
                    <View style={styles.groupSection}>
                        <Text style={styles.groupLabel}>Transfer here</Text>
                        <View style={styles.iconRow}>
                            {transferRoutes.map((r) => (
                                <RouteIcon key={r} routeId={r} onPress={isNavigableRoute(normalizeRouteIdForIcon(r)) ? () => goToLine(r) : null} />
                            ))}
                        </View>
                    </View>
                )}

                <View style={styles.groupSection}>
                    <Text style={styles.groupLabel}>Visit history</Text>
                    {visits === null ? (
                        <ActivityIndicator style={styles.statusLoading} />
                    ) : visits.length === 0 ? (
                        <Text style={styles.emptyText}>Not visited yet.</Text>
                    ) : (
                        visits.map((v) => <TripHistoryRow key={v.tripId} {...v} />)
                    )}
                </View>

                {complexId !== undefined && (
                    <View style={styles.groupSection}>
                        <StationQuestsList complexId={Number(complexId)} />
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    label: { fontSize: 15, color: '#444' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    content: { padding: 20, gap: 4 },
    stationNameHeading: { fontSize: 26, fontWeight: '700', textAlign: 'center', marginTop: 12, marginBottom: 4 },
    borough: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 24 },
    groupSection: { marginBottom: 24 },
    groupLabel: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 10 },
    iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    statusLoading: { marginTop: 12 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
    statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
    statusBadgeVisited: { backgroundColor: '#eaf6ee' },
    statusBadgeUnvisited: { backgroundColor: '#f0f0f0' },
    statusBadgeText: { fontSize: 13, fontWeight: '700' },
    statusBadgeTextVisited: { color: '#3d9a5c' },
    statusBadgeTextUnvisited: { color: '#888' },
    saveButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: '#ccc' },
    saveButtonActive: { backgroundColor: '#111', borderColor: '#111' },
    saveButtonText: { fontSize: 13, fontWeight: '700', color: '#444' },
    saveButtonTextActive: { color: '#fff' },
    emptyText: { fontSize: 14, color: '#999', fontStyle: 'italic' },
});

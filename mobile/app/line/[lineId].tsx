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
import { LINE_ICONS } from '../../constants/lineIcons';
import { LINE_COLORS } from '../../constants/lineColors';
import { getOrCreateDeviceId } from '../../lib/device';
import { writeProductEvent } from '../../db/projection';
import { getAllStationStatuses, type StationStatus } from '../../db/stations';
import { getLineStationLayout, getStationName, getOtherComplexRoutes, type LineStationGroup } from '../../lib/subwayData';
import { ProgressBar } from '../../components/ui/ProgressBar';

function LineIcon({ routeId, size }: { routeId: string; size: number }) {
    const Icon = LINE_ICONS[routeId];
    if (Icon) return <Icon width={size} height={size} />;
    return (
        <View style={[styles.colorBubble, { width: size, height: size, borderRadius: size / 2, backgroundColor: LINE_COLORS[routeId]?.bg ?? '#ccc' }]}>
            <Text style={[styles.colorBubbleText, { color: LINE_COLORS[routeId]?.text ?? '#000', fontSize: size * 0.4 }]}>{routeId}</Text>
        </View>
    );
}

function StationRow({ stopId, visited, onPress }: { stopId: string; visited: boolean; onPress: () => void }) {
    // Lightweight transfer indicator — up to 2 small secondary icons for
    // other lines reachable at this stop's complex. Deliberately not a
    // labeled two-group split (that's the Station page's job) — too dense
    // for a scrolling list of this length.
    const transferRoutes = useMemo(() => getOtherComplexRoutes(stopId), [stopId]);

    return (
        <Pressable style={styles.row} onPress={onPress}>
            <Ionicons
                name={visited ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={visited ? '#3d9a5c' : '#ccc'}
            />
            <Text style={styles.rowText} numberOfLines={1}>{getStationName(stopId)}</Text>
            {transferRoutes.length > 0 && (
                <View style={styles.transferIcons}>
                    {transferRoutes.slice(0, 2).map((r) => <LineIcon key={r} routeId={r} size={16} />)}
                </View>
            )}
            <Ionicons name="chevron-forward" size={16} color="#ccc" />
        </Pressable>
    );
}

function GroupSection({ group, statuses, onPressStation }: { group: LineStationGroup; statuses: Record<string, StationStatus>; onPressStation: (stopId: string) => void }) {
    return (
        <View style={styles.group}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            {group.stops.map((stopId) => (
                <StationRow key={stopId} stopId={stopId} visited={statuses[stopId]?.visited ?? false} onPress={() => onPressStation(stopId)} />
            ))}
        </View>
    );
}

export default function LineScreen() {
    const { lineId } = useLocalSearchParams<{ lineId: string }>();
    const db = useDb();
    const userId = useUserId();
    const insets = useSafeAreaInsets();
    const [statuses, setStatuses] = useState<Record<string, StationStatus> | null>(null);

    const layout = useMemo(() => getLineStationLayout(lineId), [lineId]);
    const totalStations = useMemo(
        () => layout.trunk.length + layout.tails.reduce((sum, t) => sum + t.stops.length, 0),
        [layout]
    );

    useEffect(() => {
        (async () => {
            setStatuses(await getAllStationStatuses(db, userId));
            const deviceId = await getOrCreateDeviceId();
            await writeProductEvent(db, 'route_detail_opened', { route_id: lineId }, { deviceId, userId });
        })();
    }, [db, userId, lineId]);

    const visitedCount = useMemo(() => {
        if (!statuses) return 0;
        let count = 0;
        for (const stopId of layout.trunk) if (statuses[stopId]?.visited) count++;
        for (const tail of layout.tails) for (const stopId of tail.stops) if (statuses[stopId]?.visited) count++;
        return count;
    }, [statuses, layout]);

    function goToStation(stopId: string) {
        router.push(`/station/${stopId}`);
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
                <ScrollView contentContainerStyle={styles.content}>
                    <View style={styles.lineHeading}>
                        <LineIcon routeId={lineId} size={64} />
                        <Text style={styles.lineNameHeading}>{lineId}</Text>
                    </View>
                    <ProgressBar current={visitedCount} target={totalStations} label="Stations visited" />

                    {layout.trunk.length > 0 && (
                        <View style={styles.group}>
                            <Text style={styles.groupLabel}>Trunk</Text>
                            {layout.trunk.map((stopId) => (
                                <StationRow key={stopId} stopId={stopId} visited={statuses[stopId]?.visited ?? false} onPress={() => goToStation(stopId)} />
                            ))}
                        </View>
                    )}

                    {layout.tails.map((tail, i) => (
                        <GroupSection key={i} group={tail} statuses={statuses} onPressStation={goToStation} />
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    content: { padding: 20, gap: 4 },
    lineHeading: { alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 16 },
    lineNameHeading: { fontSize: 24, fontWeight: '700' },
    group: { marginTop: 16, marginBottom: 16 },
    groupLabel: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    rowText: { flex: 1, fontSize: 15, color: '#222' },
    transferIcons: { flexDirection: 'row', gap: 4 },
    colorBubble: { justifyContent: 'center', alignItems: 'center' },
    colorBubbleText: { fontWeight: '700' },
});

// mobile/components/ui/TripHistoryRow.tsx
// One row per trip: date, then that trip's overall origin (first leg's line
// + station) and overall exit (last leg's line + station) -- shared between
// the Station page's per-station visit history and the Profile page's full
// trip history, since both are "a list of trips, each opening Trip Detail."
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getStationName } from '../../lib/subwayData';
import { RouteIcon } from './RouteIcon';
import type { TripEndpoints } from '../../db/trips';

type TripHistoryRowProps = { tripId: string; startedAt: string } & TripEndpoints;

export function TripHistoryRow({ tripId, startedAt, entryRouteId, entryStationId, exitRouteId, exitStationId }: TripHistoryRowProps) {
    return (
        <Pressable style={styles.row} onPress={() => router.push({ pathname: '/trip', params: { tripId } })}>
            <Text style={styles.date} numberOfLines={1}>{new Date(startedAt).toLocaleDateString()}</Text>
            <View style={styles.endpoint}>
                {entryRouteId && <RouteIcon routeId={entryRouteId} onPress={null} size={22} />}
                <Text style={styles.stationName} numberOfLines={1}>
                    {entryStationId ? getStationName(entryStationId) : '—'}
                </Text>
            </View>
            <Ionicons name="arrow-forward" size={14} color="#ccc" style={styles.arrow} />
            <View style={styles.endpoint}>
                {exitRouteId && <RouteIcon routeId={exitRouteId} onPress={null} size={22} />}
                <Text style={styles.stationName} numberOfLines={1}>
                    {exitStationId ? getStationName(exitStationId) : '—'}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#ccc" style={styles.chevron} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
    date: { fontSize: 12, color: '#888', flexShrink: 0, flexBasis: 56 },
    endpoint: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 },
    stationName: { fontSize: 13, color: '#333', flexShrink: 1 },
    arrow: { flexShrink: 0 },
    chevron: { flexShrink: 0 },
});

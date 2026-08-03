// mobile/app/(tabs)/map.tsx
import { useCallback, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import stationsData from '../../data/stations.json';
import routeShapesData from '../../data/route_shapes.json';
import { useDb } from '../../contexts/DatabaseContext';
import { useUserId } from '../../contexts/AuthContext';
import { getAllStationStatuses, type StationStatus } from '../../db/stations';
import { StationPreviewModal } from '../../components/map/StationPreviewModal';
import type { Station } from '../../lib/subwayData';

type StationsFile = Record<string, Station>;
type RouteShapeBranch = { branch_id: string; direction_id: number; color: string; points: [number, number][] };
type RouteShapesFile = Record<string, RouteShapeBranch[]>;

const STATIONS = stationsData as unknown as StationsFile;
const STATION_LIST = Object.values(STATIONS);
const ROUTE_SHAPES = routeShapesData as unknown as RouteShapesFile;
const POLYLINE_BRANCHES = Object.values(ROUTE_SHAPES).flat();

const INITIAL_REGION = {
    latitude: 40.7128,
    longitude: -73.94,
    latitudeDelta: 0.4,
    longitudeDelta: 0.4,
};

// Gray = not visited, not saved. Darker gray = saved, not yet visited.
// Green = visited -- overrides saved, per ui-spec.md's marker priority
// ("saved" is a want-to-visit intent; once fulfilled, visited is the more
// meaningful state to show).
function markerColor(status: StationStatus | undefined): string {
    if (!status) return '#c6c6c6';
    if (status.visited) return '#2e9e52';
    if (status.saved) return '#6b6b6b';
    return '#c6c6c6';
}

export default function MapScreen() {
    const db = useDb();
    const userId = useUserId();
    const [statuses, setStatuses] = useState<Record<string, StationStatus> | null>(null);
    const [selectedStation, setSelectedStation] = useState<Station | null>(null);

    // Refetched on focus, not just mount -- a trip logged elsewhere, or a
    // save/unsave made on the Station page, both happen on a different
    // screen and need to be reflected here when navigating back.
    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            (async () => {
                const result = await getAllStationStatuses(db, userId);
                if (!cancelled) setStatuses(result);
            })();
            return () => { cancelled = true; };
        }, [db, userId])
    );

    const selectedStatus = selectedStation ? statuses?.[selectedStation.stop_id] ?? null : null;

    function handleStatusChange(stationId: string, newStatus: StationStatus) {
        setStatuses((prev) => (prev ? { ...prev, [stationId]: newStatus } : prev));
    }

    if (!statuses) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <MapView style={styles.map} provider={PROVIDER_DEFAULT} initialRegion={INITIAL_REGION}>
                {POLYLINE_BRANCHES.map((branch) => (
                    <Polyline
                        key={branch.branch_id}
                        coordinates={branch.points.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                        strokeColor={branch.color}
                        strokeWidth={3}
                    />
                ))}

                {STATION_LIST.map((station) => {
                    const status = statuses[station.stop_id];
                    return (
                        <Marker
                            key={`${station.stop_id}:${status?.visited}:${status?.saved}`}
                            coordinate={{ latitude: station.lat, longitude: station.lon }}
                            onPress={() => setSelectedStation(station)}
                            tracksViewChanges={false}
                        >
                            <View style={[styles.markerDot, { backgroundColor: markerColor(status) }]} />
                        </Marker>
                    );
                })}
            </MapView>

            <StationPreviewModal
                station={selectedStation}
                status={selectedStatus}
                onClose={() => setSelectedStation(null)}
                onStatusChange={handleStatusChange}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    map: { width: '100%', height: '100%' },
    markerDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: '#fff',
    },
});

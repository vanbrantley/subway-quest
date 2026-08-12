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

// Discrete size buckets keyed off the settled region's latitudeDelta --
// smaller delta means more zoomed in. Bucketed (not a continuous formula)
// so a Marker's cache-busting `key` (see markerDot below -- tracksViewChanges
// is false, same reasoning as the visited/saved state already baked into
// the key) only changes on a real zoom-level crossing, not on every
// sub-pixel settle.
function markerSizeForDelta(latitudeDelta: number): number {
    if (latitudeDelta >= 0.2) return 9;
    if (latitudeDelta >= 0.08) return 11;
    if (latitudeDelta >= 0.03) return 13;
    if (latitudeDelta >= 0.01) return 16;
    return 19;
}

// The tappable area is bigger than the visible dot -- a small solid circle
// is hard to hit precisely, especially zoomed out, so each marker gets an
// invisible padded touch region around the dot rather than just making the
// dot itself bigger (which would clutter a wide zoomed-out view with 496
// large circles). Floors at 28pt so even the smallest zoomed-out dot has a
// reasonable target; grows with the dot at closer zoom.
function markerTouchSizeForDelta(markerSize: number): number {
    return Math.max(28, markerSize + 16);
}

export default function MapScreen() {
    const db = useDb();
    const userId = useUserId();
    const [statuses, setStatuses] = useState<Record<string, StationStatus> | null>(null);
    const [selectedStation, setSelectedStation] = useState<Station | null>(null);
    const [region, setRegion] = useState(INITIAL_REGION);
    const markerSize = markerSizeForDelta(region.latitudeDelta);
    const markerTouchSize = markerTouchSizeForDelta(markerSize);

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
            <MapView
                style={styles.map}
                provider={PROVIDER_DEFAULT}
                initialRegion={INITIAL_REGION}
                onRegionChangeComplete={setRegion}
            >
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
                            key={`${station.stop_id}:${status?.visited}:${status?.saved}:${markerSize}`}
                            coordinate={{ latitude: station.lat, longitude: station.lon }}
                            onPress={() => setSelectedStation(station)}
                            tracksViewChanges={false}
                        >
                            <View style={[styles.markerTouchArea, { width: markerTouchSize, height: markerTouchSize }]}>
                                <View
                                    style={[
                                        styles.markerDot,
                                        { width: markerSize, height: markerSize, borderRadius: markerSize / 2, backgroundColor: markerColor(status) },
                                    ]}
                                />
                            </View>
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
    markerTouchArea: { justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
    markerDot: {
        borderWidth: 1,
        borderColor: '#fff',
    },
});

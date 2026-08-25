// mobile/app/(tabs)/map.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, View, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import stationsData from '../../data/stations.json';
import routeShapesData from '../../data/route_shapes.json';
import { useDb } from '../../contexts/DatabaseContext';
import { useUserId } from '../../contexts/AuthContext';
import { getAllStationStatuses, type StationStatus } from '../../db/stations';
import { StationPreviewModal } from '../../components/map/StationPreviewModal';
import { UserLocationMarker } from '../../components/map/UserLocationMarker';
import { UserLocationPreviewModal } from '../../components/map/UserLocationPreviewModal';
import { LocationButton } from '../../components/map/LocationButton';
import { registerMapReset } from '../../lib/tabBarScrollReset';
import { consumePendingMapHighlight, type MapHighlightTarget } from '../../lib/mapHighlight';
import { useUserLocation } from '../../lib/location';
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
// smaller delta means more zoomed in. Bucketed (not a continuous formula) so
// the forceTrack pulse below (see markerDot -- most native re-snapshots only
// happen while tracksViewChanges is true) only fires on a real zoom-level
// crossing, not on every sub-pixel settle.
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
    const mapRef = useRef<MapView>(null);
    const [statuses, setStatuses] = useState<Record<string, StationStatus> | null>(null);
    const [selectedStation, setSelectedStation] = useState<Station | null>(null);
    const [region, setRegion] = useState(INITIAL_REGION);
    const markerSize = markerSizeForDelta(region.latitudeDelta);
    const markerTouchSize = markerTouchSizeForDelta(markerSize);

    // Tapping the Map tab while already on it re-centers to the starting region, same "tap the
    // active tab to reset" convention CustomTabBar uses for Profile's scroll position.
    useEffect(() => {
        registerMapReset(() => mapRef.current?.animateToRegion(INITIAL_REGION, 400));
        return () => registerMapReset(null);
    }, []);

    // forceTrack: briefly true right after a statuses refetch or a zoom-level
    // crossing, then back to false. Markers use tracksViewChanges={false} the
    // rest of the time for performance (496 of them) -- react-native-maps
    // only re-snapshots a marker's native bitmap while tracksViewChanges is
    // true, so a plain re-render alone isn't enough to force an IMMEDIATE
    // visual update on every platform; confirmed on-device that a
    // freshly-visited station's dot stayed gray until an unrelated zoom
    // gesture forced the map to redraw. Flipping this true for one render
    // pass forces a real native re-snapshot of every marker at its current
    // size/color, then flips back off to keep the normal panning/zooming
    // performance win.
    //
    // Size changes used to be handled differently -- baked into each
    // Marker's `key` below, forcing React to fully unmount and remount all
    // 496 native marker views on every zoom-level crossing. That's expensive
    // enough to visibly stutter mid-pinch-zoom, and was implicated in the
    // separate user-location dot going blank during zoom (MapKit's rendering
    // pipeline getting swamped rebuilding 496 views at once, independent of
    // that marker's own settings). Routing size changes through this same
    // pulse instead updates the existing 496 native views in place.
    const [forceTrack, setForceTrack] = useState(false);

    // Which station (if any) is showing the temporary "View on Map" highlight, and the pending
    // target stashed by Station Detail's button but not yet applied -- kept as its own state,
    // separate from forceTrack, since the highlight needs to persist for ~2.5s while forceTrack
    // itself only ever pulses true for ~100ms at a time (see the forceTrack comment above).
    // While a station is highlighted its OWN marker (only that one, not the shared forceTrack --
    // see the Marker loop below) is kept in continuous tracksViewChanges mode, both so the
    // opacity pulse animation actually gets re-snapshotted frame to frame, and so a markerSize
    // bucket crossing that happens mid-flight (the camera settling at its new, less-zoomed-in
    // region) gets picked up on that one marker too, instead of it being captured at whatever
    // stale size was in effect the instant the highlight started. Highlighting is an in-place
    // style change on the one matching marker, not a key change -- same "don't remount 496
    // views" reasoning as the size-bucketing comment above.
    const [highlightedStationId, setHighlightedStationId] = useState<string | null>(null);
    const [pendingHighlight, setPendingHighlight] = useState<MapHighlightTarget | null>(null);
    const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const highlightOpacity = useRef(new Animated.Value(1)).current;
    const highlightAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

    // Refetched on focus, not just mount -- a trip logged elsewhere, or a
    // save/unsave made on the Station page, both happen on a different
    // screen and need to be reflected here when navigating back.
    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            (async () => {
                const result = await getAllStationStatuses(db, userId);
                if (cancelled) return;
                setStatuses(result);
                setForceTrack(true);
                setTimeout(() => setForceTrack(false), 100);
            })();
            return () => { cancelled = true; };
        }, [db, userId])
    );

    useEffect(() => {
        setForceTrack(true);
        const timeout = setTimeout(() => setForceTrack(false), 100);
        return () => clearTimeout(timeout);
    }, [markerSize]);

    // Picks up a target stashed by setPendingMapHighlight() (e.g. Station Detail's "View on Map"
    // button) whenever Map gains focus. Just moves it into state here -- the actual camera
    // animation happens in the effect below, gated on `statuses` so it doesn't fire while the
    // MapView itself isn't mounted yet (see the `if (!statuses)` loading branch below).
    useFocusEffect(
        useCallback(() => {
            const target = consumePendingMapHighlight();
            if (target) setPendingHighlight(target);
        }, [])
    );

    useEffect(() => {
        if (!pendingHighlight || !statuses) return;
        // Well more zoomed out than the 0.01/0.01 "center on my location" delta -- a neighborhood
        // view around this station with several nearby stations visible for context, rather than
        // cropping in tight on just the one.
        const targetRegion = {
            latitude: pendingHighlight.lat,
            longitude: pendingHighlight.lon,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
        };
        mapRef.current?.animateToRegion(targetRegion, 500);
        // markerSize (and every marker's on-screen size) is derived from `region` state, which
        // normally only updates via the MapView's own onRegionChangeComplete callback -- but
        // that callback isn't reliable right when this fires, since it's landing mid-tab-switch
        // (see the useFocusEffect above), before the map has necessarily settled into a stable
        // layout. Relying on it left every marker sized for whatever region was current BEFORE
        // this navigation (usually the far-zoomed-out INITIAL_REGION) until the user's next
        // manual pan/gesture finally fired onRegionChangeComplete and jumped them to the right
        // size. Setting `region` directly to the region we already know we're animating toward
        // sidesteps that -- markerSize recomputes this same render, so all 496 markers resize
        // immediately rather than waiting on a native callback that may lag or never arrive for
        // this particular transition. If onRegionChangeComplete does eventually fire, it'll just
        // confirm this same value (or a near-identical one after aspect-ratio normalization).
        setRegion(targetRegion);
        setHighlightedStationId(pendingHighlight.stationId);
        setPendingHighlight(null);

        // No initial forceTrack pulse needed here -- flipping isHighlighted true below already
        // puts this one marker's own tracksViewChanges into continuous mode (see the Marker
        // loop), which captures the animated opacity; the markerSize change above already
        // pulses forceTrack for every marker via the `[markerSize]` effect if it crosses a
        // bucket boundary.
        highlightAnimationRef.current?.stop();
        highlightOpacity.setValue(1);
        highlightAnimationRef.current = Animated.loop(
            Animated.sequence([
                Animated.timing(highlightOpacity, { toValue: 0.15, duration: 350, useNativeDriver: false }),
                Animated.timing(highlightOpacity, { toValue: 1, duration: 350, useNativeDriver: false }),
            ]),
            { iterations: 3 }
        );
        highlightAnimationRef.current.start();

        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = setTimeout(() => {
            setHighlightedStationId(null);
            highlightAnimationRef.current?.stop();
            highlightOpacity.setValue(1);
            // isHighlighted just went false, so this marker's tracksViewChanges falls back to
            // the shared forceTrack -- one more brief pulse to re-snapshot it back to its plain
            // look before tracksViewChanges goes false again.
            setForceTrack(true);
            setTimeout(() => setForceTrack(false), 100);
        }, 2500);
    }, [pendingHighlight, statuses]);

    useEffect(() => {
        return () => {
            if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
            highlightAnimationRef.current?.stop();
        };
    }, []);

    // Destructured (not accessed as `location.x` inline) so the stable,
    // useCallback-memoized functions read as plain stable identifiers to
    // both React and eslint's exhaustive-deps check -- `location` itself is
    // a fresh object literal every render (coords update every few
    // seconds), and depending on the object itself would tear the watch
    // down and rebuild it on every position update instead of once per focus.
    const { status, coords, refresh, requestPermission, startWatching, stopWatching } = useUserLocation();
    const [showLocationPreview, setShowLocationPreview] = useState(false);
    // Set right before startWatching() so the *next* coords update (whether
    // from a fresh grant or an already-granted watch just kicking off)
    // triggers exactly one center-on-me animation, not a repeated one on
    // every subsequent position update.
    const pendingCenterRef = useRef(false);

    useEffect(() => {
        if (pendingCenterRef.current && coords) {
            pendingCenterRef.current = false;
            mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
        }
    }, [coords]);

    // Runs on every focus: goes straight to the real iOS permission dialog
    // the first time ever status reads 'undetermined' -- no custom rationale
    // step first (the permission string in app.json's expo-location plugin
    // already explains why, right inside that dialog). Once iOS resolves a
    // decision there's no "ask me later," so this can only fire once per
    // install; no separate persisted flag needed. On later focuses, an
    // already-granted permission just starts the watch silently -- no
    // dialog, the dot simply appears, matching how Maps apps behave.
    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            (async () => {
                const result = await refresh();
                if (cancelled) return;
                if (result.status === 'undetermined') {
                    const granted = (await requestPermission()) === 'granted';
                    if (granted) {
                        pendingCenterRef.current = true;
                        await startWatching();
                    }
                } else if (result.status === 'granted') {
                    await startWatching();
                }
            })();
            return () => {
                cancelled = true;
                stopWatching();
            };
        }, [refresh, requestPermission, startWatching, stopWatching])
    );

    function handleLocationButtonPress() {
        if (status === 'granted') {
            if (coords) {
                mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
            } else {
                pendingCenterRef.current = true;
                startWatching();
            }
            return;
        }
        // Deliberately never re-shows the rationale or re-triggers the
        // system dialog here -- iOS only offers that once per install, and
        // repeatedly asking is exactly what we don't want. Settings is the
        // only path to change a decision after the first-visit prompt.
        Alert.alert('Location is off', 'Turn it on in Settings to see your position on the map.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]);
    }

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
                ref={mapRef}
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
                    const isHighlighted = station.stop_id === highlightedStationId;
                    return (
                        <Marker
                            key={`${station.stop_id}:${status?.visited}:${status?.saved}`}
                            coordinate={{ latitude: station.lat, longitude: station.lon }}
                            onPress={() => setSelectedStation(station)}
                            tracksViewChanges={forceTrack || isHighlighted}
                        >
                            <View style={[styles.markerTouchArea, { width: markerTouchSize, height: markerTouchSize }]}>
                                <Animated.View
                                    style={[
                                        styles.markerDot,
                                        { width: markerSize, height: markerSize, borderRadius: markerSize / 2, backgroundColor: markerColor(status) },
                                        isHighlighted && {
                                            opacity: highlightOpacity,
                                            borderWidth: 3,
                                            borderColor: '#007aff',
                                        },
                                    ]}
                                />
                            </View>
                        </Marker>
                    );
                })}

                {coords && (
                    <UserLocationMarker
                        coords={coords}
                        size={markerSize}
                        touchSize={markerTouchSize}
                        tracksViewChanges={forceTrack}
                        onPress={() => setShowLocationPreview(true)}
                    />
                )}
            </MapView>

            <LocationButton active={status === 'granted'} onPress={handleLocationButtonPress} />

            <StationPreviewModal
                station={selectedStation}
                status={selectedStatus}
                onClose={() => setSelectedStation(null)}
                onStatusChange={handleStatusChange}
            />

            <UserLocationPreviewModal visible={showLocationPreview} onClose={() => setShowLocationPreview(false)} />
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

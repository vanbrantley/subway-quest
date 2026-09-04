// mobile/components/search/RandomStationButton.tsx
//
// Search tab's discovery tool: a bottom-left FAB that cycles through line
// icons in random order before landing on a station the rider hasn't
// visited yet (falls back to any station once every one has been visited),
// then offers "View station" / "Show on map" / re-rolling for it. Pure
// discovery -- no cooldown, no quest/trivia hook (see plan doc).
//
// The result outlives the modal being hidden: picking a line icon, "View
// station," or "Show on map" all navigate away without clearing
// resultStation, only hiding the modal (modalVisible). useFocusEffect below
// reopens it with the same result the moment this tab regains focus --
// whether that's a back-press from the pushed station/line page or a tab
// switch back from Map -- so the rider lands back in the same "keep
// re-rolling until something interests you" modal rather than a bare
// search screen. Only an explicit backdrop-tap dismiss clears the result
// for good.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import { router, useFocusEffect, useRootNavigationState } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDb } from '../../contexts/DatabaseContext';
import { useUserId } from '../../contexts/AuthContext';
import { getAllStationStatuses } from '../../db/stations';
import { setPendingMapHighlight } from '../../lib/mapHighlight';
import { navigateToTab } from '../../lib/tabBarReset';
import { LINE_ICONS } from '../../constants/lineIcons';
import { LINE_COLORS } from '../../constants/lineColors';
import {
    getStation, getDisplayableRoutes, getBoroughName,
    isNavigableRoute, normalizeRouteIdForIcon, type Station,
} from '../../lib/subwayData';

const AVAILABLE_ROUTES = getDisplayableRoutes();

// Slot-machine-style slowdown: short gaps at first, then longer ones as it
// settles, ~1.1s total before landing on the real result.
const TICK_DELAYS = [70, 80, 100, 120, 150, 190, 230, 260];
const LANDING_PAUSE_MS = 450;

function CycleIcon({ routeId, size, onPress }: { routeId: string; size: number; onPress?: () => void }) {
    const iconId = normalizeRouteIdForIcon(routeId);
    const Icon = LINE_ICONS[iconId];
    const content = Icon ? (
        <Icon width={size} height={size} />
    ) : (
        <View style={[styles.colorBubble, { width: size, height: size, borderRadius: size / 2, backgroundColor: LINE_COLORS[iconId]?.bg ?? '#ccc' }]}>
            <Text style={[styles.colorBubbleText, { color: LINE_COLORS[iconId]?.text ?? '#000', fontSize: size * 0.4 }]}>{iconId}</Text>
        </View>
    );
    if (!onPress || !isNavigableRoute(iconId)) return content;
    return <Pressable onPress={onPress}>{content}</Pressable>;
}

type Phase = 'idle' | 'cycling' | 'result';

export function RandomStationButton() {
    const db = useDb();
    const userId = useUserId();
    const rootState = useRootNavigationState();

    const [phase, setPhase] = useState<Phase>('idle');
    const [modalVisible, setModalVisible] = useState(false);
    const [cyclingRouteId, setCyclingRouteId] = useState<string | null>(null);
    const [resultStation, setResultStation] = useState<Station | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }, []);

    // Re-show the card with its cached result on return to this tab -- a
    // back-press from the station/line page it sent the rider to, or
    // switching back from Map after "Show on map." Only fires when there's
    // still a live (non-dismissed) result to restore.
    useFocusEffect(
        useCallback(() => {
            if (phase === 'result') setModalVisible(true);
        }, [phase])
    );

    function runCycle(landingRouteId: string, onDone: () => void) {
        let i = 0;
        function tick() {
            setCyclingRouteId(AVAILABLE_ROUTES[Math.floor(Math.random() * AVAILABLE_ROUTES.length)]);
            if (i < TICK_DELAYS.length - 1) {
                i += 1;
                timeoutRef.current = setTimeout(tick, TICK_DELAYS[i]);
            } else {
                setCyclingRouteId(landingRouteId);
                timeoutRef.current = setTimeout(onDone, LANDING_PAUSE_MS);
            }
        }
        tick();
    }

    async function roll() {
        setPhase('cycling');
        setModalVisible(true);

        const statuses = await getAllStationStatuses(db, userId);
        const allIds = Object.keys(statuses);
        const unvisited = allIds.filter((id) => !statuses[id].visited);
        const pool = unvisited.length > 0 ? unvisited : allIds;
        const stopId = pool[Math.floor(Math.random() * pool.length)];
        const station = getStation(stopId);
        if (!station) {
            setPhase('idle');
            setModalVisible(false);
            return;
        }

        const landingRouteId = station.daytime_routes[0] ?? AVAILABLE_ROUTES[0];
        runCycle(landingRouteId, () => {
            setResultStation(station);
            setPhase('result');
        });
    }

    function handleFabPress() {
        if (phase === 'cycling') return;
        roll();
    }

    function dismiss() {
        setPhase('idle');
        setModalVisible(false);
        setResultStation(null);
    }

    // Hides the modal without clearing the cached result -- useFocusEffect
    // above brings it back when the rider returns to this tab.
    function navigateAway(action: () => void) {
        setModalVisible(false);
        action();
    }

    function viewStation() {
        if (!resultStation) return;
        const stopId = resultStation.stop_id;
        navigateAway(() => router.push(`/station/${stopId}`));
    }

    function goToLine(routeId: string) {
        const target = normalizeRouteIdForIcon(routeId);
        navigateAway(() => router.push(`/line/${target}`));
    }

    function showOnMap() {
        if (!resultStation) return;
        const { stop_id: stationId, lat, lon } = resultStation;
        navigateAway(() => {
            setPendingMapHighlight({ stationId, lat, lon });
            navigateToTab('map', rootState);
        });
    }

    return (
        <>
            <Pressable style={styles.fab} onPress={handleFabPress} accessibilityLabel="Find a random station">
                <Ionicons name="shuffle" size={28} color="#fff" />
            </Pressable>

            <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={dismiss}>
                <Pressable style={styles.backdrop} onPress={phase === 'result' ? dismiss : undefined}>
                    <Pressable style={styles.card} onPress={() => {}}>
                        {phase === 'cycling' && cyclingRouteId && (
                            <View style={styles.cyclingWrap}>
                                <CycleIcon routeId={cyclingRouteId} size={72} />
                                <Text style={styles.cyclingLabel}>Picking a station…</Text>
                            </View>
                        )}

                        {phase === 'result' && resultStation && (
                            <>
                                <Text style={styles.name} numberOfLines={2}>{resultStation.name}</Text>
                                <Text style={styles.borough}>{getBoroughName(resultStation.borough)}</Text>

                                <View style={styles.iconRow}>
                                    {resultStation.daytime_routes.map((r) => (
                                        <CycleIcon key={r} routeId={r} size={32} onPress={() => goToLine(r)} />
                                    ))}
                                </View>

                                <View style={styles.actionsRow}>
                                    <Pressable style={styles.actionButton} onPress={showOnMap}>
                                        <Text style={styles.actionButtonText}>Show on map</Text>
                                    </Pressable>
                                    <Pressable style={[styles.actionButton, styles.actionButtonPrimary]} onPress={viewStation}>
                                        <Text style={[styles.actionButtonText, styles.actionButtonTextPrimary]}>View station</Text>
                                    </Pressable>
                                </View>

                                <Pressable style={styles.rerollButton} onPress={roll}>
                                    <Ionicons name="shuffle" size={16} color="#444" />
                                    <Text style={styles.rerollText}>Randomize again</Text>
                                </Pressable>
                            </>
                        )}
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    fab: {
        position: 'absolute',
        left: 24,
        bottom: 16,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#111',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 4,
    },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', gap: 4 },
    cyclingWrap: { alignItems: 'center', gap: 14, paddingVertical: 12 },
    cyclingLabel: { fontSize: 14, color: '#888', fontWeight: '600' },
    name: { fontSize: 19, fontWeight: '700', textAlign: 'center', color: '#111' },
    borough: { fontSize: 13, color: '#888', marginBottom: 14 },
    iconRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginBottom: 18 },
    colorBubble: { justifyContent: 'center', alignItems: 'center' },
    colorBubbleText: { fontWeight: '700' },
    actionsRow: { flexDirection: 'row', gap: 10, width: '100%' },
    actionButton: { flex: 1, paddingVertical: 12, borderRadius: 22, alignItems: 'center', borderWidth: 1, borderColor: '#ccc' },
    actionButtonPrimary: { backgroundColor: '#111', borderColor: '#111' },
    actionButtonText: { fontSize: 14, fontWeight: '600', color: '#444' },
    actionButtonTextPrimary: { color: '#fff' },
    rerollButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        width: '100%',
        marginTop: 10,
        paddingVertical: 12,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: '#ccc',
    },
    rerollText: { fontSize: 14, fontWeight: '600', color: '#444' },
});

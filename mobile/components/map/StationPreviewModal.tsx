// mobile/components/map/StationPreviewModal.tsx
//
// Map tab's marker-tap preview -- a centered modal card with a dimmed
// backdrop, per this milestone's decision (deviates from ui-spec.md's
// original "bottom sheet" wording, same kind of deviation already
// documented there for the trip-logging flow's full-screen->page-sheet
// change). Built with RN's own <Modal>, no new native dependency.

import { useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDb } from '../../contexts/DatabaseContext';
import { useUserId } from '../../contexts/AuthContext';
import { useSyncEngine } from '../../contexts/SyncContext';
import { LINE_ICONS } from '../../constants/lineIcons';
import { LINE_COLORS } from '../../constants/lineColors';
import { getOrCreateDeviceId } from '../../lib/device';
import { saveStation, unsaveStation } from '../../db/projection';
import type { StationStatus } from '../../db/stations';
import { getBoroughName, isNavigableRoute, normalizeRouteIdForIcon, type Station } from '../../lib/subwayData';

function RouteIcon({ routeId, onPress }: { routeId: string; onPress: () => void }) {
    const iconId = normalizeRouteIdForIcon(routeId);
    const Icon = LINE_ICONS[iconId];
    const navigable = isNavigableRoute(iconId);
    const content = Icon ? (
        <Icon width={32} height={32} />
    ) : (
        <View style={[styles.colorBubble, { backgroundColor: LINE_COLORS[iconId]?.bg ?? '#ccc' }]}>
            <Text style={[styles.colorBubbleText, { color: LINE_COLORS[iconId]?.text ?? '#000' }]}>{routeId}</Text>
        </View>
    );
    if (!navigable) return <View style={styles.routeIconWrap}>{content}</View>;
    return <Pressable style={styles.routeIconWrap} onPress={onPress}>{content}</Pressable>;
}

type Props = {
    station: Station | null;
    status: StationStatus | null;
    onClose: () => void;
    onStatusChange: (stationId: string, status: StationStatus) => void;
};

export function StationPreviewModal({ station, status, onClose, onStatusChange }: Props) {
    const db = useDb();
    const userId = useUserId();
    const { triggerSync } = useSyncEngine();
    const [saving, setSaving] = useState(false);

    const visible = station !== null;

    function goToLine(routeId: string) {
        const target = normalizeRouteIdForIcon(routeId);
        onClose();
        router.push(`/line/${target}`);
    }

    function goToStation() {
        if (!station) return;
        onClose();
        router.push(`/station/${station.stop_id}`);
    }

    async function toggleSave() {
        if (!station || !status || saving) return;
        setSaving(true);
        try {
            const deviceId = await getOrCreateDeviceId();
            const ctx = { deviceId, userId };
            if (status.saved) {
                await unsaveStation(db, station.stop_id, ctx);
            } else {
                await saveStation(db, station.stop_id, ctx);
            }
            onStatusChange(station.stop_id, { ...status, saved: !status.saved });
            triggerSync();
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable style={styles.card} onPress={() => {}}>
                    {station && (
                        <>
                            <Text style={styles.name} numberOfLines={2}>{station.name}</Text>
                            <Text style={styles.borough}>{getBoroughName(station.borough)}</Text>

                            <View style={styles.iconRow}>
                                {station.daytime_routes.map((r) => (
                                    <RouteIcon key={r} routeId={r} onPress={() => goToLine(r)} />
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

                            <Pressable style={styles.viewButton} onPress={goToStation}>
                                <Text style={styles.viewButtonText}>View station</Text>
                            </Pressable>
                        </>
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', gap: 4 },
    name: { fontSize: 19, fontWeight: '700', textAlign: 'center', color: '#111' },
    borough: { fontSize: 13, color: '#888', marginBottom: 14 },
    iconRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginBottom: 14 },
    routeIconWrap: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
    colorBubble: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    colorBubbleText: { fontWeight: '700', fontSize: 12 },
    statusLoading: { marginBottom: 14 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
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
    viewButton: { paddingVertical: 12, paddingHorizontal: 28, backgroundColor: '#111', borderRadius: 22, width: '100%', alignItems: 'center' },
    viewButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});

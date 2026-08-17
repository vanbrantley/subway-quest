// mobile/app/debug.tsx
// Dev-only. Not linked from any tab/nav — reach it via router.push('/debug')
// from a REPL/temporary button, or Expo Router's dev menu "Go to route".
// Dumps events/trips/legs/sync_status as raw JSON so the testing checklist's
// verification steps don't require manual SQL each session.
import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useDb } from '../contexts/DatabaseContext';
import { useSyncEngine } from '../contexts/SyncContext';

type BannerKind = 'info' | 'success' | 'error';

export default function DebugScreen() {
    const db = useDb();
    const insets = useSafeAreaInsets();
    const [data, setData] = useState<Record<string, unknown[]> | null>(null);
    const { triggerSync, isSyncing, lastSyncAt, lastSyncError } = useSyncEngine();

    const [banner, setBanner] = useState<{ text: string; kind: BannerKind } | null>(null);
    const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showBanner = useCallback((text: string, kind: BannerKind = 'info', durationMs = 2500) => {
        if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
        setBanner({ text, kind });
        bannerTimeoutRef.current = setTimeout(() => setBanner(null), durationMs);
    }, []);

    const refresh = useCallback(async () => {
        const [events, trips, legs, syncStatus] = await Promise.all([
            db.getAllAsync('SELECT * FROM events ORDER BY recorded_at DESC LIMIT 50'),
            db.getAllAsync('SELECT * FROM trips ORDER BY started_at DESC LIMIT 20'),
            db.getAllAsync('SELECT * FROM legs ORDER BY trip_id, sequence'),
            db.getAllAsync('SELECT * FROM sync_status ORDER BY event_id'),
        ]);
        const dump = { events, trips, legs, sync_status: syncStatus };
        setData(dump);
        const counts = `events=${events.length} trips=${trips.length} legs=${legs.length} sync_status=${syncStatus.length}`;
        console.log(`[debug] refresh done — ${counts}`);
        // console.log('[debug] full dump:', JSON.stringify(dump, null, 2));
        return counts;
    }, [db]);

    useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

    // Only show a banner for syncs the user actually asked for from this
    // screen (Trigger Sync / Force Re-sync) -- background syncs (on mount,
    // reconnect, app foreground) still get logged below for visibility but
    // shouldn't pop UI the user didn't ask for.
    const userTriggeredSyncRef = useRef(false);
    const wasSyncingRef = useRef(isSyncing);
    useEffect(() => {
        if (wasSyncingRef.current && !isSyncing) {
            if (lastSyncError) {
                console.log(`[debug] sync failed — ${lastSyncError}`);
                if (userTriggeredSyncRef.current) showBanner(`Sync failed: ${lastSyncError}`, 'error', 4000);
            } else {
                const at = lastSyncAt ? lastSyncAt.toLocaleTimeString() : 'unknown time';
                console.log(`[debug] sync completed at ${at}`);
                if (userTriggeredSyncRef.current) showBanner(`Sync complete — ${at}`, 'success');
            }
            userTriggeredSyncRef.current = false;
            refresh();
        }
        wasSyncingRef.current = isSyncing;
    }, [isSyncing, lastSyncAt, lastSyncError, refresh, showBanner]);

    async function handleRefresh() {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        console.log('[debug] Refresh pressed');
        showBanner('Refreshing…', 'info', 1200);
        const counts = await refresh();
        showBanner(`Refreshed — ${counts}`, 'success');
    }

    function handleTriggerSync() {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        console.log('[debug] Trigger Sync pressed');
        showBanner('Sync triggered…', 'info', 1500);
        userTriggeredSyncRef.current = true;
        triggerSync();
    }

    // Testing-only: resets already-synced rows back to pending so a sync
    // pass has something to actually retry — the only way to exercise
    // idempotency (ON CONFLICT DO NOTHING) without a real second device.
    async function handleForceResyncAll() {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        console.log('[debug] Force Re-sync All pressed');
        showBanner('Resetting synced rows…', 'info', 1500);
        const before = await db.getFirstAsync<{ count: number }>(
            `SELECT COUNT(*) as count FROM sync_status WHERE status = 'synced'`
        );
        const resetCount = before?.count ?? 0;
        await db.runAsync(`UPDATE sync_status SET status = 'pending', synced_at = NULL WHERE status = 'synced'`);
        console.log(`[debug] Force Re-sync All: reset ${resetCount} row(s) from synced -> pending`);
        await refresh();
        showBanner(`Reset ${resetCount} row(s) — sync starting…`, 'success');
        userTriggeredSyncRef.current = true;
        triggerSync();
    }

    function handleBack() {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        console.log('[debug] Back pressed');
        router.back();
    }

    // Guard is after hooks, not before — a pre-hook `if (!__DEV__) return null`
    // would violate rules-of-hooks (hook count/order must stay identical across
    // renders even though __DEV__ itself never flips at runtime). __DEV__ is
    // stripped in production bundles regardless, so this never ships live.
    if (!__DEV__) return null;

    return (
        <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
            <View style={styles.header}>
                <Pressable onPress={handleBack} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
                    <Text style={styles.backText}>‹ Back</Text>
                </Pressable>
                <Text style={styles.title}>DB Dump (dev only)</Text>
                <Pressable onPress={handleRefresh} style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}>
                    <Text style={styles.refreshText}>Refresh</Text>
                </Pressable>
            </View>
            {banner && (
                <View style={[styles.banner, styles[`banner_${banner.kind}`]]}>
                    <Text style={styles.bannerText}>{banner.text}</Text>
                </View>
            )}
            <View style={styles.syncBar}>
                <Text style={styles.syncText}>
                    {isSyncing ? 'Syncing…' : lastSyncAt ? `Last synced: ${lastSyncAt.toLocaleTimeString()}` : 'Not synced yet'}
                </Text>
                {lastSyncError && <Text style={styles.syncError}>Error: {lastSyncError}</Text>}
                <View style={styles.syncButtons}>
                    <Pressable
                        onPress={handleTriggerSync}
                        disabled={isSyncing}
                        style={({ pressed }) => [styles.syncButton, pressed && styles.pressed, isSyncing && styles.syncButtonDisabled]}
                    >
                        <Text style={styles.syncButtonText}>{isSyncing ? 'Syncing…' : 'Trigger Sync'}</Text>
                    </Pressable>
                    <Pressable
                        onPress={handleForceResyncAll}
                        disabled={isSyncing}
                        style={({ pressed }) => [styles.syncButton, pressed && styles.pressed, isSyncing && styles.syncButtonDisabled]}
                    >
                        <Text style={styles.syncButtonText}>Force Re-sync All</Text>
                    </Pressable>
                </View>
            </View>
            <ScrollView contentContainerStyle={styles.content}>
                {data ? (
                    Object.entries(data).map(([table, rows]) => (
                        <View key={table} style={styles.section}>
                            <Text style={styles.sectionTitle}>{table} ({rows.length})</Text>
                            <Text style={styles.json} selectable>{JSON.stringify(rows, null, 2)}</Text>
                        </View>
                    ))
                ) : <Text style={styles.json}>Loading…</Text>}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    title: { fontSize: 17, fontWeight: '600' },
    backButton: { paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8 },
    backText: { fontSize: 15, color: '#111', fontWeight: '500' },
    refreshButton: { paddingVertical: 6, paddingHorizontal: 14, backgroundColor: '#111', borderRadius: 16 },
    refreshText: { color: '#fff', fontWeight: '600', fontSize: 13 },
    pressed: { opacity: 0.5, transform: [{ scale: 0.96 }] },
    banner: { marginHorizontal: 16, marginBottom: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
    banner_info: { backgroundColor: '#e6effe' },
    banner_success: { backgroundColor: '#e3f7e8' },
    banner_error: { backgroundColor: '#fbe4e2' },
    bannerText: { fontSize: 13, fontWeight: '600', color: '#111' },
    content: { paddingHorizontal: 16, paddingBottom: 40 },
    section: { marginBottom: 20 },
    sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 6, color: '#333' },
    json: { fontFamily: 'Courier', fontSize: 11, color: '#444' },
    syncBar: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
    syncText: { fontSize: 13, color: '#444', marginBottom: 4 },
    syncError: { fontSize: 12, color: '#c00', marginBottom: 6 },
    syncButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },
    syncButton: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#111', borderRadius: 14 },
    syncButtonDisabled: { backgroundColor: '#999' },
    syncButtonText: { color: '#fff', fontWeight: '600', fontSize: 12 },
});

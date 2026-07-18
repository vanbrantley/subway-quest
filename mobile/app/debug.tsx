// mobile/app/debug.tsx
// Dev-only. Not linked from any tab/nav — reach it via router.push('/debug')
// from a REPL/temporary button, or Expo Router's dev menu "Go to route".
// Dumps events/trips/legs/sync_status as raw JSON so the testing checklist's
// verification steps don't require manual SQL each session.
import { useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '../contexts/DatabaseContext';
import { useSyncEngine } from '../contexts/SyncContext';

export default function DebugScreen() {
    const db = useDb();
    const insets = useSafeAreaInsets();
    const [data, setData] = useState<Record<string, unknown[]> | null>(null);
    const { triggerSync, isSyncing, lastSyncAt, lastSyncError } = useSyncEngine();

    const refresh = useCallback(async () => {
        const [events, trips, legs, syncStatus] = await Promise.all([
            db.getAllAsync('SELECT * FROM events ORDER BY recorded_at DESC LIMIT 50'),
            db.getAllAsync('SELECT * FROM trips ORDER BY started_at DESC LIMIT 20'),
            db.getAllAsync('SELECT * FROM legs ORDER BY trip_id, sequence'),
            db.getAllAsync('SELECT * FROM sync_status ORDER BY event_id'),
        ]);
        const dump = { events, trips, legs, sync_status: syncStatus };
        setData(dump);
        console.log('DB DUMP:', JSON.stringify(dump, null, 2));
    }, [db]);

    useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

    // Testing-only: resets already-synced rows back to pending so a sync
    // pass has something to actually retry — the only way to exercise
    // idempotency (ON CONFLICT DO NOTHING) without a real second device.
    async function forceResyncAll() {
        await db.runAsync(`UPDATE sync_status SET status = 'pending', synced_at = NULL WHERE status = 'synced'`);
        await refresh();
        triggerSync();
    }

    // Guard is after hooks, not before — a pre-hook `if (!__DEV__) return null`
    // would violate rules-of-hooks (hook count/order must stay identical across
    // renders even though __DEV__ itself never flips at runtime). __DEV__ is
    // stripped in production bundles regardless, so this never ships live.
    if (!__DEV__) return null;

    return (
        <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} style={styles.backButton}>
                    <Text style={styles.backText}>‹ Back</Text>
                </Pressable>
                <Text style={styles.title}>DB Dump (dev only)</Text>
                <Pressable onPress={refresh} style={styles.refreshButton}>
                    <Text style={styles.refreshText}>Refresh</Text>
                </Pressable>
            </View>
            <View style={styles.syncBar}>
                <Text style={styles.syncText}>
                    {isSyncing ? 'Syncing…' : lastSyncAt ? `Last synced: ${lastSyncAt.toLocaleTimeString()}` : 'Not synced yet'}
                </Text>
                {lastSyncError && <Text style={styles.syncError}>Error: {lastSyncError}</Text>}
                <View style={styles.syncButtons}>
                    <Pressable onPress={triggerSync} style={styles.syncButton}>
                        <Text style={styles.syncButtonText}>Trigger Sync</Text>
                    </Pressable>
                    <Pressable onPress={forceResyncAll} style={styles.syncButton}>
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
    backButton: { paddingVertical: 6, paddingHorizontal: 4 },
    backText: { fontSize: 15, color: '#111', fontWeight: '500' },
    refreshButton: { paddingVertical: 6, paddingHorizontal: 14, backgroundColor: '#111', borderRadius: 16 },
    refreshText: { color: '#fff', fontWeight: '600', fontSize: 13 },
    content: { paddingHorizontal: 16, paddingBottom: 40 },
    section: { marginBottom: 20 },
    sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 6, color: '#333' },
    json: { fontFamily: 'Courier', fontSize: 11, color: '#444' },
    syncBar: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
    syncText: { fontSize: 13, color: '#444', marginBottom: 4 },
    syncError: { fontSize: 12, color: '#c00', marginBottom: 6 },
    syncButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },
    syncButton: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#111', borderRadius: 14 },
    syncButtonText: { color: '#fff', fontWeight: '600', fontSize: 12 },
});
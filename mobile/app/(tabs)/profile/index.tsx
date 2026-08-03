// mobile/app/(tabs)/profile/index.tsx
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useDb } from '../../../contexts/DatabaseContext';
import { useUserId } from '../../../contexts/AuthContext';
import { getBoroughName } from '../../../lib/subwayData';
import { getProfileStats, getSavedStations, type ProfileStats, type SavedStation } from '../../../db/stations';
import { ProfileQuestsSummary } from '../../../components/quests/ProfileQuestsSummary';

type TripRow = { trip_id: string; origin_station_id: string; destination_station_id: string; started_at: string };

function StatTile({ label, value }: { label: string; value: string | number }) {
    return (
        <View style={styles.statTile}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
        </View>
    );
}

function SectionHeader({ title }: { title: string }) {
    return <Text style={styles.sectionHeader}>{title}</Text>;
}

export default function ProfileScreen() {
    const db = useDb();
    const userId = useUserId();
    const insets = useSafeAreaInsets();

    const [stats, setStats] = useState<ProfileStats | null>(null);
    const [savedStations, setSavedStations] = useState<SavedStation[] | null>(null);
    const [trips, setTrips] = useState<TripRow[] | null>(null);

    // Refetched on focus, not just mount -- logging a trip or toggling a
    // save both happen on other screens and need to be reflected here on
    // return, same reasoning as the Map tab.
    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            (async () => {
                const [profileStats, saved, tripRows] = await Promise.all([
                    getProfileStats(db, userId),
                    getSavedStations(db, userId),
                    db.getAllAsync<TripRow>(
                        `SELECT trip_id, origin_station_id, destination_station_id, started_at
                         FROM trips WHERE user_id = ? ORDER BY started_at DESC`,
                        [userId]
                    ),
                ]);
                if (cancelled) return;
                setStats(profileStats);
                setSavedStations(saved);
                setTrips(tripRows);
            })();
            return () => { cancelled = true; };
        }, [db, userId])
    );

    if (!stats || !savedStations || !trips) {
        return <View style={styles.centered}><ActivityIndicator /></View>;
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Text style={styles.title}>Profile</Text>
                <Pressable onPress={() => supabase.auth.signOut()} accessibilityLabel="Sign out">
                    <Ionicons name="settings-outline" size={24} color="#111" />
                </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.statsRow}>
                    <StatTile label="Rides logged" value={stats.ridesLogged} />
                    <StatTile label="Stations visited" value={stats.stationsVisited} />
                    <StatTile label="Network explored" value={`${stats.pctVisitedOverall}%`} />
                </View>

                <SectionHeader title="By borough" />
                {stats.pctVisitedByBorough.map((b) => (
                    <View key={b.borough} style={styles.boroughRow}>
                        <Text style={styles.boroughName}>{getBoroughName(b.borough)}</Text>
                        <Text style={styles.boroughStat}>{b.visited} / {b.total} ({b.pct}%)</Text>
                    </View>
                ))}

                <SectionHeader title="Favorites" />
                <Text style={styles.favoriteLine}>
                    Favorite station: {stats.favoriteStations.length > 0 ? stats.favoriteStations.map((s) => s.name).join(', ') : '—'}
                </Text>
                <Text style={styles.favoriteLine}>
                    Favorite line: {stats.favoriteLines.length > 0 ? stats.favoriteLines.map((l) => l.routeId).join(', ') : '—'}
                </Text>
                <Text style={styles.favoriteLine}>
                    Least-travelled: {stats.leastTravelledLines.length > 0 ? stats.leastTravelledLines.map((l) => l.routeId).join(', ') : '—'}
                </Text>

                <SectionHeader title={`Trip history (${trips.length})`} />
                {trips.length === 0 ? (
                    <Text style={styles.emptyText}>No trips logged yet.</Text>
                ) : (
                    trips.map((t) => (
                        <Pressable
                            key={t.trip_id}
                            style={styles.row}
                            onPress={() => router.push({ pathname: '/trip', params: { tripId: t.trip_id } })}
                        >
                            <Ionicons name="train-outline" size={18} color="#999" />
                            <Text style={styles.rowText}>{new Date(t.started_at).toLocaleDateString()}</Text>
                            <Ionicons name="chevron-forward" size={16} color="#ccc" />
                        </Pressable>
                    ))
                )}

                <SectionHeader title={`Saved stations (${savedStations.length})`} />
                {savedStations.length === 0 ? (
                    <Text style={styles.emptyText}>No saved stations yet.</Text>
                ) : (
                    savedStations.map((s) => (
                        <Pressable key={s.stationId} style={styles.row} onPress={() => router.push(`/station/${s.stationId}`)}>
                            <Ionicons
                                name={s.visited ? 'checkmark-circle' : 'bookmark'}
                                size={18}
                                color={s.visited ? '#3d9a5c' : '#999'}
                            />
                            <Text style={styles.rowText}>{s.name}</Text>
                            <Ionicons name="chevron-forward" size={16} color="#ccc" />
                        </Pressable>
                    ))
                )}

                <SectionHeader title="Achievements" />
                <ProfileQuestsSummary />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12 },
    title: { fontSize: 22, fontWeight: '700' },
    content: { padding: 20, paddingTop: 4, gap: 4 },
    statsRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
    statTile: { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
    statValue: { fontSize: 20, fontWeight: '700', color: '#111' },
    statLabel: { fontSize: 11, color: '#888', marginTop: 2, textAlign: 'center' },
    sectionHeader: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 20, marginBottom: 8 },
    boroughRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
    boroughName: { fontSize: 14, color: '#333' },
    boroughStat: { fontSize: 14, color: '#888' },
    favoriteLine: { fontSize: 14, color: '#333', paddingVertical: 3 },
    emptyText: { fontSize: 14, color: '#999', fontStyle: 'italic' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
    rowText: { flex: 1, fontSize: 15, color: '#222' },
});

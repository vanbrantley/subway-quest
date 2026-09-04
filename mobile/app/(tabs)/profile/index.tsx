// mobile/app/(tabs)/profile/index.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '../../../contexts/DatabaseContext';
import { useUserId } from '../../../contexts/AuthContext';
import { registerProfileNavigation } from '../../../lib/tabBarReset';
import { registerProfileScrollReset } from '../../../lib/tabBarScrollReset';
import { TAB_BAR_HEIGHT } from '../../../components/CustomTabBar';
import { getBoroughName, getStation } from '../../../lib/subwayData';
import { localDateString, type TimeRange } from '../../../lib/dateMath';
import { getProfileStats, getSavedStations, getFavoritesForRange, type ProfileStats, type SavedStation } from '../../../db/stations';
import { getTripHistory, type TripHistoryEntry } from '../../../db/trips';
import { bucketRidesByLocalDay, computeStreaksPure } from '../../../db/ride_activity_logic';
import type { FavoriteStation, RouteRideCount } from '../../../db/stations_logic';
import { ProfileQuestsSummary } from '../../../components/quests/ProfileQuestsSummary';
import { ProgressBar } from '../../../components/ui/ProgressBar';
import { RouteIcon } from '../../../components/ui/RouteIcon';
import { SectionHeader } from '../../../components/ui/SectionHeader';
import { PaginatedList } from '../../../components/ui/PaginatedList';
import { FavoritesCharts } from '../../../components/profile/FavoritesCharts';
import { TripHistoryList } from '../../../components/profile/TripHistoryList';
import { RideHeatmap } from '../../../components/profile/RideHeatmap';

function StatTile({ label, value }: { label: string; value: string | number }) {
    return (
        <View style={styles.statTile}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
        </View>
    );
}

export default function ProfileScreen() {
    const db = useDb();
    const userId = useUserId();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation();
    const scrollRef = useRef<ScrollView>(null);

    // Hands this screen's navigation object (the nested Profile stack's own, since this file is
    // inside it -- see lib/tabBarReset.ts) up to CustomTabBar, so tapping the Profile tab can pop
    // this stack back to root the same way it clears the outer root stack.
    useEffect(() => {
        registerProfileNavigation(navigation);
        return () => registerProfileNavigation(null);
    }, [navigation]);

    // Tapping the Profile tab while already on it scrolls back to top, same "tap the active tab
    // to reset" convention CustomTabBar uses for the Map tab's region.
    useEffect(() => {
        registerProfileScrollReset(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
        return () => registerProfileScrollReset(null);
    }, []);

    const [stats, setStats] = useState<ProfileStats | null>(null);
    const [savedStations, setSavedStations] = useState<SavedStation[] | null>(null);
    const [trips, setTrips] = useState<TripHistoryEntry[] | null>(null);

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
                    getTripHistory(db, userId),
                ]);
                if (cancelled) return;
                setStats(profileStats);
                setSavedStations(saved);
                setTrips(tripRows);
            })();
            return () => { cancelled = true; };
        }, [db, userId])
    );

    // Own state/fetch, separate from the effect above -- switching the
    // favorites time range shouldn't refetch stats/savedStations/trips too.
    const [favorites, setFavorites] = useState<{ stations: FavoriteStation[]; lines: RouteRideCount[] } | null>(null);
    const [favoritesRange, setFavoritesRange] = useState<TimeRange>('all');
    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            (async () => {
                const result = await getFavoritesForRange(db, userId, favoritesRange);
                if (!cancelled) setFavorites(result);
            })();
            return () => { cancelled = true; };
        }, [db, userId, favoritesRange])
    );

    // Derived from the same trips already loaded for Trip History -- no
    // separate fetch needed for the heatmap/streak stats.
    const dayCounts = useMemo(() => bucketRidesByLocalDay((trips ?? []).map((t) => t.startedAt)), [trips]);
    const streaks = useMemo(() => computeStreaksPure(dayCounts, localDateString()), [dayCounts]);

    if (!stats || !savedStations || !trips) {
        return <View style={styles.centered}><ActivityIndicator /></View>;
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Text style={styles.title}>Profile</Text>
                <Pressable onPress={() => router.push('/profile/settings')} accessibilityLabel="Settings">
                    <Ionicons name="settings-outline" size={24} color="#111" />
                </Pressable>
            </View>

            <ScrollView ref={scrollRef} contentContainerStyle={[styles.content, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 20 }]}>
                <View style={styles.statsRow}>
                    <StatTile label="Rides logged" value={stats.ridesLogged} />
                    <StatTile label="Stations visited" value={stats.stationsVisited} />
                    <StatTile label="Network explored" value={`${stats.pctVisitedOverall}%`} />
                </View>

                <SectionHeader title="By borough" style={styles.sectionSpacing} />
                {stats.pctVisitedByBorough.map((b) => (
                    <View key={b.borough} style={styles.boroughRow}>
                        <View style={styles.boroughHeaderRow}>
                            <Text style={styles.boroughName}>{getBoroughName(b.borough)}</Text>
                            <Text style={styles.boroughPct}>{b.pct}%</Text>
                        </View>
                        <ProgressBar current={b.visited} target={b.total} />
                    </View>
                ))}

                <SectionHeader title="Activity" style={styles.sectionSpacing} />
                <View style={styles.statsRow}>
                    <StatTile label="Current streak" value={`${streaks.currentStreak}d`} />
                    <StatTile label="Longest streak" value={`${streaks.longestStreak}d`} />
                </View>
                {dayCounts.length > 0 ? (
                    <RideHeatmap dayCounts={dayCounts} />
                ) : (
                    <Text style={styles.emptyText}>No rides logged yet.</Text>
                )}

                <SectionHeader title="Favorites" style={styles.sectionSpacing} />
                <FavoritesCharts favorites={favorites} range={favoritesRange} onRangeChange={setFavoritesRange} />

                <TripHistoryList trips={trips} />

                <PaginatedList
                    title="Saved stations"
                    items={savedStations}
                    keyExtractor={(s) => s.stationId}
                    itemNoun="stations"
                    emptyText="No saved stations yet."
                    headerStyle={styles.sectionSpacing}
                    renderItem={(s) => {
                        const routes = getStation(s.stationId)?.daytime_routes ?? [];
                        return (
                            <Pressable style={styles.row} onPress={() => router.push(`/station/${s.stationId}`)}>
                                <Ionicons
                                    name={s.visited ? 'checkmark-circle' : 'bookmark'}
                                    size={18}
                                    color={s.visited ? '#3d9a5c' : '#999'}
                                />
                                <View style={styles.rowIcons}>
                                    {routes.map((r) => <RouteIcon key={r} routeId={r} onPress={null} size={20} />)}
                                </View>
                                <Text style={styles.rowText} numberOfLines={1}>{s.name}</Text>
                                <Ionicons name="chevron-forward" size={16} color="#ccc" />
                            </Pressable>
                        );
                    }}
                />

                <SectionHeader title="Achievements" style={styles.sectionSpacing} />
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
    // This page's content container uses a small gap: 4 between children
    // (unlike e.g. achievements/[questId].tsx's gap: 24), so each top-level
    // section header carries its own top margin instead of relying on the
    // parent gap -- see SectionHeader.tsx's comment on why this can't be
    // that component's own default.
    sectionSpacing: { marginTop: 20 },
    boroughRow: { paddingVertical: 6, gap: 4 },
    boroughHeaderRow: { flexDirection: 'row', justifyContent: 'space-between' },
    boroughName: { fontSize: 14, color: '#333' },
    boroughPct: { fontSize: 14, color: '#888' },
    emptyText: { fontSize: 14, color: '#999', fontStyle: 'italic' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
    rowIcons: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flexShrink: 0 },
    rowText: { flex: 1, fontSize: 15, color: '#222' },
});

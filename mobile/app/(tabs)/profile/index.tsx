// mobile/app/(tabs)/profile/index.tsx
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '../../../contexts/DatabaseContext';
import { useUserId } from '../../../contexts/AuthContext';
import { getBoroughName, getStation, isNavigableRoute, normalizeRouteIdForIcon } from '../../../lib/subwayData';
import { getProfileStats, getSavedStations, type ProfileStats, type SavedStation } from '../../../db/stations';
import { getTripHistory, type TripHistoryEntry } from '../../../db/trips';
import { ProfileQuestsSummary } from '../../../components/quests/ProfileQuestsSummary';
import { ProgressBar } from '../../../components/ui/ProgressBar';
import { TripHistoryRow } from '../../../components/ui/TripHistoryRow';
import { RouteIcon } from '../../../components/ui/RouteIcon';

type FavoriteStationEntry = ProfileStats['favoriteStations'][number];

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

// Shared across favorite station/favorite line/least-travelled so the three
// sit together as one visually consistent unit rather than each picking its
// own size in isolation.
const FAVORITES_ICON_SIZE = 32;

// Tappable line icon, guarded by isNavigableRoute the same way
// station/[stationId].tsx's/trip.tsx's goToLine() are -- some ridden routes
// (the shuttle-grouping gap, see status.md's "Mobile UI -- remaining") have
// no Line page to push to yet.
function LineIconLink({ routeId, size = FAVORITES_ICON_SIZE }: { routeId: string; size?: number }) {
    const target = normalizeRouteIdForIcon(routeId);
    const navigable = isNavigableRoute(target);
    return <RouteIcon routeId={routeId} onPress={navigable ? () => router.push(`/line/${target}`) : null} size={size} />;
}

// One pick from the (already alphabetically-sorted) tie list -- "favorite"
// reads as singular, so a tie just resolves to the first one rather than
// listing every station/line tied for most-ridden.
function FavoriteStationRow({ station }: { station: FavoriteStationEntry }) {
    const routes = getStation(station.stationId)?.daytime_routes ?? [];
    return (
        <Pressable style={styles.row} onPress={() => router.push(`/station/${station.stationId}`)}>
            <View style={styles.rowIcons}>
                {routes.map((r) => <RouteIcon key={r} routeId={r} onPress={null} size={FAVORITES_ICON_SIZE} />)}
            </View>
            <Text style={styles.rowText} numberOfLines={1}>{station.name}</Text>
            <Ionicons name="chevron-forward" size={16} color="#ccc" />
        </Pressable>
    );
}

export default function ProfileScreen() {
    const db = useDb();
    const userId = useUserId();
    const insets = useSafeAreaInsets();

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

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.statsRow}>
                    <StatTile label="Rides logged" value={stats.ridesLogged} />
                    <StatTile label="Stations visited" value={stats.stationsVisited} />
                    <StatTile label="Network explored" value={`${stats.pctVisitedOverall}%`} />
                </View>

                <SectionHeader title="By borough" />
                {stats.pctVisitedByBorough.map((b) => (
                    <View key={b.borough} style={styles.boroughRow}>
                        <View style={styles.boroughHeaderRow}>
                            <Text style={styles.boroughName}>{getBoroughName(b.borough)}</Text>
                            <Text style={styles.boroughPct}>{b.pct}%</Text>
                        </View>
                        <ProgressBar current={b.visited} target={b.total} />
                    </View>
                ))}

                <SectionHeader title="Favorites" />

                <Text style={styles.favoritesLabel}>Favorite station</Text>
                {stats.favoriteStations.length > 0 ? (
                    <FavoriteStationRow station={stats.favoriteStations[0]} />
                ) : (
                    <Text style={styles.emptyText}>—</Text>
                )}

                <Text style={[styles.favoritesLabel, styles.favoritesLabelSpaced]}>Favorite line</Text>
                {stats.favoriteLines.length > 0 ? (
                    <LineIconLink routeId={stats.favoriteLines[0].routeId} />
                ) : (
                    <Text style={styles.emptyText}>—</Text>
                )}

                <Text style={[styles.favoritesLabel, styles.favoritesLabelSpaced]}>Least-travelled</Text>
                {stats.leastTravelledLines.length > 0 ? (
                    <View style={styles.iconRow}>
                        {stats.leastTravelledLines.map((l) => <LineIconLink key={l.routeId} routeId={l.routeId} />)}
                    </View>
                ) : (
                    <Text style={styles.emptyText}>—</Text>
                )}

                <SectionHeader title={`Trip history (${trips.length})`} />
                {trips.length === 0 ? (
                    <Text style={styles.emptyText}>No trips logged yet.</Text>
                ) : (
                    trips.map((t) => <TripHistoryRow key={t.tripId} {...t} />)
                )}

                <SectionHeader title={`Saved stations (${savedStations.length})`} />
                {savedStations.length === 0 ? (
                    <Text style={styles.emptyText}>No saved stations yet.</Text>
                ) : (
                    savedStations.map((s) => {
                        const routes = getStation(s.stationId)?.daytime_routes ?? [];
                        return (
                            <Pressable key={s.stationId} style={styles.row} onPress={() => router.push(`/station/${s.stationId}`)}>
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
                    })
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
    boroughRow: { paddingVertical: 6, gap: 4 },
    boroughHeaderRow: { flexDirection: 'row', justifyContent: 'space-between' },
    boroughName: { fontSize: 14, color: '#333' },
    boroughPct: { fontSize: 14, color: '#888' },
    favoritesLabel: { fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
    favoritesLabelSpaced: { marginTop: 16 },
    iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    emptyText: { fontSize: 14, color: '#999', fontStyle: 'italic' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
    rowIcons: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flexShrink: 0 },
    rowText: { flex: 1, fontSize: 15, color: '#222' },
});

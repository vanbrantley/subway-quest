// mobile/app/trip.tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '../contexts/DatabaseContext';
import { useUserId } from '../contexts/AuthContext';
import { getStationName } from '../lib/subwayData';
import { LINE_ICONS } from '../constants/lineIcons';
import { LINE_COLORS } from '../constants/lineColors';
import { computeTripQuestProgress, type QuestTripProgress } from '../db/quests';

type TripRow = { trip_id: string; origin_station_id: string; destination_station_id: string; started_at: string };
type LegRow = { leg_id: string; sequence: number; route_id: string; entry_station_id: string; exit_station_id: string };

export default function TripDetailScreen() {
    const { tripId } = useLocalSearchParams<{ tripId: string }>();
    const db = useDb();
    const userId = useUserId();
    const insets = useSafeAreaInsets();
    const [trip, setTrip] = useState<TripRow | null>(null);
    const [legs, setLegs] = useState<LegRow[]>([]);
    const [questProgress, setQuestProgress] = useState<QuestTripProgress[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const tripRow = await db.getFirstAsync<TripRow>(
                'SELECT trip_id, origin_station_id, destination_station_id, started_at FROM trips WHERE trip_id = ?',
                [tripId]
            );
            const legRows = await db.getAllAsync<LegRow>(
                'SELECT leg_id, sequence, route_id, entry_station_id, exit_station_id FROM legs WHERE trip_id = ? ORDER BY sequence',
                [tripId]
            );
            setTrip(tripRow);
            setLegs(legRows);

            // Deliberately computed on every visit, not just right after logging --
            // computeTripQuestProgress compares "history with this trip" vs
            // "history without it" from scratch each time, so it's correct
            // whether this screen was just reached from log-trip.tsx's
            // finishTrip() or from Profile's trip history much later.
            // Re-showing "this trip contributed to X" on a later revisit is a
            // true statement about the trip, not a one-time animation that
            // needs a "seen" flag -- no cached state needed, matches this
            // project's standing no-cached-progress-table principle (see
            // data-layer.md's Quest progress computation).
            //
            // Shows EVERY quest this trip moved the needle on, not just full
            // completions -- partial progress (e.g. Beachy going 1/6 -> 2/6)
            // is exactly as visible as a full completion, by design: the
            // point is the dopamine hit and quest awareness on every trip,
            // not just the rare ones that finish something.
            if (tripRow) {
                const progress = await computeTripQuestProgress(db, userId, tripRow.trip_id);
                setQuestProgress(progress);
            }

            setLoading(false);
        })();
    }, [tripId, db, userId]);

    if (loading) return <View style={styles.centered}><ActivityIndicator /></View>;
    if (!trip) return <View style={styles.centered}><Text style={styles.label}>Trip not found.</Text></View>;

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable onPress={() => router.back()} accessibilityLabel="Close">
                    <Ionicons name="close" size={28} color="#111" />
                </Pressable>
                <Text style={styles.title}>Trip Summary</Text>
                <View style={{ width: 28 }} />
            </View>
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.route}>
                    {getStationName(trip.origin_station_id)} → {getStationName(trip.destination_station_id)}
                </Text>
                <Text style={styles.date}>{new Date(trip.started_at).toLocaleDateString()}</Text>

                {legs.map((leg) => {
                    const Icon = LINE_ICONS[leg.route_id];
                    return (
                        <View key={leg.leg_id} style={styles.legRow}>
                            {Icon ? <Icon width={28} height={28} /> : (
                                <View style={[styles.colorDot, { backgroundColor: LINE_COLORS[leg.route_id]?.bg ?? '#ccc' }]}>
                                    <Text style={styles.colorDotText}>{leg.route_id}</Text>
                                </View>
                            )}
                            <Text style={styles.legText}>
                                {getStationName(leg.entry_station_id)} → {getStationName(leg.exit_station_id)}
                            </Text>
                        </View>
                    );
                })}

                {questProgress.length > 0 && (
                    <View style={styles.questsSection}>
                        <Text style={styles.questsSectionTitle}>Quest progress</Text>
                        {questProgress.map((q) => {
                            const justCompleted = !q.completedBefore && q.completedAfter;
                            return (
                                <Pressable
                                    key={q.questId}
                                    style={styles.questRow}
                                    onPress={() => router.push(`/achievements/${q.questId}`)}
                                >
                                    <Ionicons
                                        name={justCompleted ? 'ribbon' : 'trending-up'}
                                        size={22}
                                        color={justCompleted ? '#c9962c' : '#5b8def'}
                                    />
                                    <View style={styles.questRowTextWrap}>
                                        <Text style={styles.questRowText}>{q.title}</Text>
                                        {q.currentAfter !== null && q.target !== null && (
                                            <Text style={styles.questRowProgress}>
                                                {q.currentAfter} / {q.target}
                                                {justCompleted ? ' — Completed!' : ''}
                                            </Text>
                                        )}
                                        {q.currentAfter === null && justCompleted && (
                                            <Text style={styles.questRowProgress}>Completed!</Text>
                                        )}
                                    </View>
                                </Pressable>
                            );
                        })}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    title: { fontSize: 17, fontWeight: '600' },
    content: { padding: 20, gap: 16 },
    route: { fontSize: 20, fontWeight: '700' },
    date: { fontSize: 14, color: '#888' },
    label: { fontSize: 15, color: '#444' },
    legRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    legText: { fontSize: 15, color: '#333' },
    colorDot: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    colorDotText: { fontSize: 11, fontWeight: '700' },
    questsSection: { backgroundColor: '#fdf6e8', borderRadius: 14, padding: 16, gap: 12 },
    questsSectionTitle: { fontSize: 15, fontWeight: '700', color: '#8a6d1f' },
    questRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    questRowTextWrap: { flex: 1 },
    questRowText: { fontSize: 15, color: '#333', fontWeight: '600' },
    questRowProgress: { fontSize: 13, color: '#777', marginTop: 2 },
});
// mobile/app/trip.tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '../contexts/DatabaseContext';
import { useUserId } from '../contexts/AuthContext';
import { getStationName, isNavigableRoute, normalizeRouteIdForIcon } from '../lib/subwayData';
import { computeTripQuestProgress, type QuestTripProgress } from '../db/quests';
import { computeTripTriviaReveals, type TriviaRevealDetail } from '../db/trivia';
import { computeTripInsights, type EnrichedInsightFact } from '../db/insights';
import { isDiscoveryFact, selectInsightsForDisplay } from '../db/insights_logic';
import { deleteTrip } from '../db/projection';
import { useTriviaPreferences } from '../contexts/TriviaPreferencesContext';
import { getOrCreateDeviceId } from '../lib/device';
import { ProgressBar } from '../components/ui/ProgressBar';
import { RouteIcon } from '../components/ui/RouteIcon';
import { TAB_BAR_HEIGHT } from '../components/CustomTabBar';

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
    const [triviaReveals, setTriviaReveals] = useState<TriviaRevealDetail[]>([]);
    const [insights, setInsights] = useState<EnrichedInsightFact[]>([]);
    const [loading, setLoading] = useState(true);
    const { factsEnabled } = useTriviaPreferences();

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

                // Same "recompute from full history every visit" shape as quest
                // progress/trivia above -- general, non-quest facts (repeat-trip
                // counts, unique-station milestones, etc.), always computed
                // regardless of the Fun Facts toggle since they're not trivia.
                const insightFacts = await computeTripInsights(db, userId, tripRow.trip_id);
                setInsights(insightFacts);

                // Same "recompute from full history every visit" reasoning as
                // the quest progress call above -- a trivia reveal is exactly
                // as true on a later revisit of this screen as it was right
                // after logging, so there's no separate "seen" flag to track.
                // Skipped entirely when facts are off -- no point diffing
                // history for a section that won't render.
                if (factsEnabled) {
                    const reveals = await computeTripTriviaReveals(db, userId, tripRow.trip_id);
                    setTriviaReveals(reveals);
                }
            }

            setLoading(false);
        })();
    }, [tripId, db, userId, factsEnabled]);

    function goToLine(routeId: string) {
        const target = normalizeRouteIdForIcon(routeId);
        if (!isNavigableRoute(target)) return;
        router.push(`/line/${target}`);
    }

    function confirmDelete() {
        Alert.alert(
            'Delete this trip?',
            "This can't be undone.",
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: performDelete },
            ]
        );
    }

    async function performDelete() {
        const deviceId = await getOrCreateDeviceId();
        await deleteTrip(db, tripId, { deviceId, userId });
        router.back();
    }

    if (loading) return <View style={styles.centered}><ActivityIndicator /></View>;
    if (!trip) return <View style={styles.centered}><Text style={styles.label}>Trip not found.</Text></View>;

    // Discoveries (a brand new station or line) always show in full -- see
    // isDiscoveryFact -- they're never subject to the ranking/cap below.
    // Everything else adapts: when Quest progress, a trivia reveal, or a
    // discovery already have something to show, only surface a genuinely
    // notable extra insight (and just one) -- don't pile on, EXCEPT a repeat
    // of a trip you've ridden before, which always shows as long as this
    // trip itself had no discoveries (see selectInsightsForDisplay). When
    // nothing else is on the page at all (the common routine-commute case),
    // the cap relaxes further so a plain repeat trip isn't reduced to one
    // line. See insights_logic.ts.
    const discoveries = insights.filter(isDiscoveryFact);
    const otherFacts = insights.filter((f) => !isDiscoveryFact(f));
    const hasOtherContent = questProgress.length > 0 || (factsEnabled && triviaReveals.length > 0) || discoveries.length > 0;
    // Sparkle/text insights read first, with the station/line discoveries
    // (which already have their own visual weight -- icon, name, tap target)
    // grouped below them.
    const shownInsights = [...selectInsightsForDisplay(otherFacts, hasOtherContent, discoveries.length > 0), ...discoveries];

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable onPress={() => router.back()} accessibilityLabel="Close">
                    <Ionicons name="close" size={28} color="#111" />
                </Pressable>
                <Text style={styles.title}>Trip Summary</Text>
                <Pressable onPress={confirmDelete} accessibilityLabel="Delete trip">
                    <Ionicons name="trash-outline" size={24} color="#111" />
                </Pressable>
            </View>
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 20 }]}>
                <View style={styles.routeRow}>
                    <Pressable onPress={() => router.push(`/station/${trip.origin_station_id}`)}>
                        <Text style={styles.route}>{getStationName(trip.origin_station_id)}</Text>
                    </Pressable>
                    <Text style={styles.route}> → </Text>
                    <Pressable onPress={() => router.push(`/station/${trip.destination_station_id}`)}>
                        <Text style={styles.route}>{getStationName(trip.destination_station_id)}</Text>
                    </Pressable>
                </View>
                <Text style={styles.date}>{new Date(trip.started_at).toLocaleDateString()}</Text>

                {legs.map((leg) => (
                    <View key={leg.leg_id} style={styles.legRow}>
                        <RouteIcon
                            routeId={leg.route_id}
                            onPress={isNavigableRoute(normalizeRouteIdForIcon(leg.route_id)) ? () => goToLine(leg.route_id) : null}
                            size={28}
                        />
                        <View style={styles.legTextRow}>
                            <Pressable onPress={() => router.push(`/station/${leg.entry_station_id}`)}>
                                <Text style={styles.legText}>{getStationName(leg.entry_station_id)}</Text>
                            </Pressable>
                            <Text style={styles.legText}> → </Text>
                            <Pressable onPress={() => router.push(`/station/${leg.exit_station_id}`)}>
                                <Text style={styles.legText}>{getStationName(leg.exit_station_id)}</Text>
                            </Pressable>
                        </View>
                    </View>
                ))}

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
                                        {/* A separate "Completed!" caption, not the bar's own fraction
                                            text -- for a tiered counting quest, `target` is always the
                                            NEXT unreached tier (see quests_logic.ts's evaluateTiers), so
                                            the bar itself has to stay honest (e.g. "5 of 10" toward tier
                                            2) even on the trip that just crossed tier 1. Saying
                                            "Completed!" as the bar's fraction text produced a
                                            contradiction (a bar that's only 55% full claiming to be
                                            done); splitting it into its own line above the bar keeps
                                            both true at once -- same pattern the achievements detail
                                            page already uses (a completion badge separate from the
                                            honest next-tier bar). */}
                                        {justCompleted && q.currentAfter !== null && (
                                            <Text style={styles.questRowTierCompleted}>Tier completed!</Text>
                                        )}
                                        {q.currentAfter !== null && q.target !== null && (
                                            <ProgressBar current={q.currentAfter} target={q.target} ticks={q.tiers} />
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

                {factsEnabled && triviaReveals.length > 0 && (
                    <View style={styles.triviaSection}>
                        <Text style={styles.triviaSectionTitle}>New discovery</Text>
                        {triviaReveals.map((r) => {
                            const onPress = r.kind === 'station'
                                ? (r.stopId ? () => router.push(`/station/${r.stopId}`) : undefined)
                                : () => router.push(`/line/${r.routeId}`);
                            return (
                                <Pressable
                                    key={r.kind === 'station' ? `station-${r.complexId}` : `line-${r.routeId}`}
                                    style={styles.triviaRow}
                                    onPress={onPress}
                                    disabled={!onPress}
                                >
                                    {r.routeId && <RouteIcon routeId={r.routeId} onPress={null} size={26} />}
                                    <View style={styles.triviaTextWrap}>
                                        <Text style={styles.triviaName}>{r.displayName}</Text>
                                        <Text style={styles.triviaText}>{r.fact}</Text>
                                    </View>
                                    {onPress && <Ionicons name="chevron-forward" size={16} color="#ccc" />}
                                </Pressable>
                            );
                        })}
                    </View>
                )}

                {shownInsights.length > 0 && (
                    <View style={styles.insightsSection}>
                        <Text style={styles.insightsSectionTitle}>Insights</Text>
                        {shownInsights.map((fact) => {
                            // route_ride_count, new_line_ridden, and
                            // nth_unique_station are tied to a specific line/station
                            // -- navigable, with that line's icon, same as the leg
                            // list above and the trivia section's rows. The other
                            // fact types (overall trip count, repeat/pattern facts)
                            // aren't about any single navigable entity, so they
                            // render as plain rows.
                            if (fact.type === 'route_ride_count' || fact.type === 'new_line_ridden') {
                                const target = normalizeRouteIdForIcon(fact.routeId);
                                const navigable = isNavigableRoute(target);
                                return (
                                    <Pressable
                                        key={insightKey(fact)}
                                        style={styles.insightRow}
                                        onPress={navigable ? () => goToLine(fact.routeId) : undefined}
                                        disabled={!navigable}
                                    >
                                        <View style={styles.insightIconWrap}>
                                            <RouteIcon routeId={fact.routeId} onPress={null} size={26} />
                                        </View>
                                        <Text style={styles.insightText}>{insightText(fact)}</Text>
                                        {navigable && <Ionicons name="chevron-forward" size={16} color="#ccc" />}
                                    </Pressable>
                                );
                            }
                            if (fact.type === 'nth_unique_station') {
                                return (
                                    <Pressable
                                        key={insightKey(fact)}
                                        style={styles.insightRow}
                                        onPress={() => router.push(`/station/${fact.stopId}`)}
                                    >
                                        <View style={styles.insightIconWrap}>
                                            <RouteIcon routeId={fact.routeId} onPress={null} size={26} />
                                        </View>
                                        <Text style={styles.insightText}>{insightText(fact)}</Text>
                                        <Ionicons name="chevron-forward" size={16} color="#ccc" />
                                    </Pressable>
                                );
                            }
                            return (
                                <View key={insightKey(fact)} style={styles.insightRow}>
                                    <View style={styles.insightIconWrap}>
                                        <Ionicons name="sparkles" size={20} color="#5b8def" />
                                    </View>
                                    <Text style={styles.insightText}>{insightText(fact)}</Text>
                                </View>
                            );
                        })}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

function insightKey(fact: EnrichedInsightFact): string {
    switch (fact.type) {
        case 'nth_unique_station': return `station-${fact.stopId}`;
        case 'route_ride_count':
        case 'new_line_ridden': return `route-${fact.routeId}`;
        default: return fact.type;
    }
}

function ordinal(n: number): string {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
}

// Per-type sentence templates -- the one place display text is derived from
// a structured fact, kept deliberately dumb (a plain switch, no shared
// phrasing logic) so a future narration layer can replace just this
// function without touching how facts are computed or selected.
function insightText(fact: EnrichedInsightFact): string {
    switch (fact.type) {
        case 'nth_trip_overall':
            return `Trip #${fact.n} — keep it up!`;
        case 'unique_trip_pattern':
            return `New route! This is your ${ordinal(fact.n)} unique trip.`;
        case 'trip_repeat_count':
            return `You've ridden this exact trip ${fact.count} times now!`;
        case 'nth_unique_station':
            return `${fact.stationName} — new station visited!`;
        case 'new_line_ridden':
            return 'New line ridden!';
        case 'route_ride_count':
            return `You've ridden the ${fact.routeId} ${fact.count} times now!`;
    }
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    title: { fontSize: 17, fontWeight: '600' },
    content: { padding: 20, gap: 16 },
    routeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
    route: { fontSize: 20, fontWeight: '700' },
    date: { fontSize: 14, color: '#888' },
    label: { fontSize: 15, color: '#444' },
    legRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    legTextRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', flex: 1 },
    legText: { fontSize: 15, color: '#333' },
    questsSection: { backgroundColor: '#fdf6e8', borderRadius: 14, padding: 16, gap: 12 },
    questsSectionTitle: { fontSize: 15, fontWeight: '700', color: '#8a6d1f' },
    questRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    questRowTextWrap: { flex: 1 },
    questRowText: { fontSize: 15, color: '#333', fontWeight: '600' },
    questRowProgress: { fontSize: 13, color: '#777', marginTop: 2 },
    // Sits between the title and the next-tier ProgressBar -- marginBottom
    // gives the bar below it room to breathe instead of crowding right
    // underneath the text.
    questRowTierCompleted: { fontSize: 13, color: '#777', marginTop: 2, marginBottom: 6 },
    triviaSection: { backgroundColor: '#fdf6e8', borderRadius: 14, padding: 16, gap: 12 },
    triviaSectionTitle: { fontSize: 15, fontWeight: '700', color: '#8a6d1f' },
    triviaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    triviaTextWrap: { flex: 1, gap: 2 },
    triviaName: { fontSize: 15, fontWeight: '700', color: '#333' },
    triviaText: { fontSize: 15, color: '#333', lineHeight: 20 },
    insightsSection: { backgroundColor: '#fdf6e8', borderRadius: 14, padding: 16, gap: 12 },
    insightsSectionTitle: { fontSize: 15, fontWeight: '700', color: '#8a6d1f' },
    insightRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    // Fixed-width so the sparkle icon (a smaller Ionicon) and the RouteIcon
    // (26px, used for line/station insights) both center within the same
    // box -- otherwise the smaller sparkle icon left text starting further
    // left than rows with a RouteIcon, misaligning the text column.
    insightIconWrap: { width: 26, alignItems: 'center', justifyContent: 'center' },
    insightText: { fontSize: 15, color: '#333', flex: 1 },
});
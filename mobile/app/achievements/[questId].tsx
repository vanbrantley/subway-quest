// mobile/app/achievements/[questId].tsx (root-level -- reached from multiple contexts:
// the achievements list, trip.tsx, and eventually StationQuestsList -- same pattern as
// station/[stationId].tsx and line/[lineId].tsx. See milestone-8-achievements.md's
// "Known open items" for why this isn't nested under (tabs)/profile/.)
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '../../contexts/DatabaseContext';
import { useUserId } from '../../contexts/AuthContext';
import { getQuestDetail, type QuestDetail, type EnrichedGroupBreakdownItem } from '../../db/quests';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { RouteIcon } from '../../components/ui/RouteIcon';
import { TripHistoryRow } from '../../components/ui/TripHistoryRow';
import { TAB_BAR_HEIGHT } from '../../components/CustomTabBar';
import { isNavigableRoute, normalizeRouteIdForIcon, getStation } from '../../lib/subwayData';

function formatTripsLabel(tripIds: string[], tripDates: Record<string, string>): string | null {
    if (tripIds.length === 0) return null;
    const dates = tripIds.map((id) => tripDates[id]).filter(Boolean).sort();
    if (dates.length === 0) return null;
    const first = new Date(dates[0]).toLocaleDateString();
    return dates.length === 1 ? `Visited ${first}` : `Visited ${first} (+${dates.length - 1} more)`;
}

function goToStation(stopId: string | null) {
    if (!stopId) return;
    router.push(`/station/${stopId}`);
}

// Every route serving a given stop_id -- for the trailing line-icon cluster
// on a station row. One row per station means every route on that platform
// is relevant, unlike a 'pairs' row (see BreakdownList's 'pairs' case),
// which is already scoped to one specific route.
function routesForStop(stopId: string | null): string[] {
    return stopId ? getStation(stopId)?.daytime_routes ?? [] : [];
}

// onPress is optional -- rows for items with no known navigation target
// (e.g. a station whose stop_id couldn't be resolved) just render inert,
// same as everywhere else in the app that guards navigation this way.
// routeIds render trailing (after the label, before the chevron) --
// deliberately NOT leading like RouteIcon's usage in TripChipStrip/Trip
// Detail/TripHistoryRow: those rows' subject IS the route, but here the
// station is the subject and the route is a qualifier, and the checkmark
// already owns the leading-icon slot.
function ChecklistRow({ visited, label, sublabel, routeIds, onPress }: { visited: boolean; label: string; sublabel: string | null; routeIds?: string[]; onPress?: (() => void) | null }) {
    const content = (
        <>
            <Ionicons
                name={visited ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={visited ? '#3d9a5c' : '#ccc'}
            />
            <View style={styles.checklistTextWrap}>
                <Text style={[styles.checklistLabel, !visited && styles.checklistLabelPending]}>{label}</Text>
                {sublabel && <Text style={styles.checklistSublabel}>{sublabel}</Text>}
            </View>
            {routeIds && routeIds.length > 0 && (
                <View style={styles.trailingRouteIcons}>
                    {routeIds.map((r) => <RouteIcon key={r} routeId={r} onPress={null} size={18} />)}
                </View>
            )}
            {onPress && <Ionicons name="chevron-forward" size={16} color="#ccc" />}
        </>
    );
    if (!onPress) return <View style={styles.checklistRow}>{content}</View>;
    return <Pressable style={styles.checklistRow} onPress={onPress}>{content}</Pressable>;
}

// One group's header + progress bar + member rows, collapsed by default --
// member rows only render when expanded. Applies uniformly to every
// 'groups'-kind quest regardless of size (Five Boroughs' 5 groups can have
// up to 156 members each; Déjà Vu has 54 groups; Neighborhood Native has 25)
// rather than special-casing only the largest ones, so behavior stays
// predictable across every quest that uses this breakdown kind.
function GroupBlock({ item }: { item: EnrichedGroupBreakdownItem }) {
    const [expanded, setExpanded] = useState(false);
    // OR semantics (minRequired <= 1: boroughs, neighborhoods, branch tails)
    // use the resolver-supplied group label, since members have different
    // names. AND semantics (minRequired > 1: Déjà Vu's same-name clusters)
    // use the shared member name instead -- every member already has the
    // same display name, so a separate label was never needed there.
    const label = item.minRequired <= 1 ? (item.label ?? `Group ${item.groupIndex + 1}`) : item.names[0];
    return (
        <View style={styles.groupBlock}>
            <Pressable style={styles.groupHeaderRow} onPress={() => setExpanded((e) => !e)}>
                <Text style={styles.groupHeader}>{label}</Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#999" />
            </Pressable>
            <ProgressBar current={item.visitedComplexIds.length} target={item.minRequired} />
            {expanded && item.complexIds.map((cid, i) => (
                // Matched by complexId, NOT name -- every member of a same-name
                // cluster shares the literal same name string, so name-matching
                // can't tell them apart (real bug found on-device: every row
                // showed checked the moment just one was visited).
                <ChecklistRow
                    key={cid}
                    visited={item.visitedComplexIds.includes(cid)}
                    label={item.names[i]}
                    sublabel={null}
                    routeIds={routesForStop(item.stopIds[i])}
                    onPress={item.stopIds[i] ? () => goToStation(item.stopIds[i]) : null}
                />
            ))}
        </View>
    );
}

function BreakdownList({ quest }: { quest: QuestDetail }) {
    const { breakdown, tripDates } = quest;

    switch (breakdown.kind) {
        case 'stations':
            return (
                <View style={styles.groupSection}>
                    <SectionHeader title="Stations" />
                    {breakdown.items.map((item) => (
                        <ChecklistRow
                            key={item.complexId}
                            visited={item.visited}
                            label={item.name}
                            sublabel={formatTripsLabel(item.tripIds, tripDates)}
                            routeIds={routesForStop(item.stopId)}
                            onPress={item.stopId ? () => goToStation(item.stopId) : null}
                        />
                    ))}
                </View>
            );

        case 'groups':
            // Every group -- header, progress bar, collapsed member rows by
            // default (tap to expand) -- regardless of OR/AND semantics or
            // size. See GroupBlock for why collapse applies uniformly rather
            // than only to the largest groups.
            return (
                <>
                    {breakdown.items.map((item) => <GroupBlock key={item.groupIndex} item={item} />)}
                </>
            );

        case 'pairs':
            // Each row is scoped to one specific (station, route) pair -- the
            // route icon shows only that row's own route, never every line at
            // the station, so a hub like Times Sq (many rows, one per
            // required route) doesn't misrepresent what any single row needs.
            return (
                <View style={styles.groupSection}>
                    <SectionHeader title="Stations" />
                    {breakdown.items.map((item) => (
                        <ChecklistRow
                            key={`${item.station}-${item.route}`}
                            visited={item.visited}
                            label={item.stationName}
                            sublabel={formatTripsLabel(item.tripIds, tripDates)}
                            routeIds={[item.route]}
                            onPress={item.stopId ? () => goToStation(item.stopId) : null}
                        />
                    ))}
                </View>
            );

        case 'routes':
            return (
                <View style={styles.groupSection}>
                    <SectionHeader title="Lines" />
                    {breakdown.items.map((item) => {
                        const navigable = isNavigableRoute(normalizeRouteIdForIcon(item.route));
                        const onPress = navigable ? () => router.push(`/line/${normalizeRouteIdForIcon(item.route)}`) : null;
                        const content = (
                            <>
                                <Ionicons
                                    name={item.visited ? 'checkmark-circle' : 'ellipse-outline'}
                                    size={22}
                                    color={item.visited ? '#3d9a5c' : '#ccc'}
                                />
                                <RouteIcon routeId={item.route} onPress={null} size={28} />
                                <View style={styles.checklistTextWrap}>
                                    <Text style={[styles.checklistLabel, !item.visited && styles.checklistLabelPending]}>{item.route} line</Text>
                                    {formatTripsLabel(item.tripIds, tripDates) && (
                                        <Text style={styles.checklistSublabel}>{formatTripsLabel(item.tripIds, tripDates)}</Text>
                                    )}
                                </View>
                                {onPress && <Ionicons name="chevron-forward" size={16} color="#ccc" />}
                            </>
                        );
                        return onPress ? (
                            <Pressable key={item.route} style={styles.checklistRow} onPress={onPress}>{content}</Pressable>
                        ) : (
                            <View key={item.route} style={styles.checklistRow}>{content}</View>
                        );
                    })}
                </View>
            );

        case 'per_trip':
            return (
                <View style={styles.groupSection}>
                    <SectionHeader title="Qualifying trips" />
                    {breakdown.qualifyingTripIds.length === 0 ? (
                        <Text style={styles.emptyText}>No trip has satisfied this yet.</Text>
                    ) : (
                        breakdown.qualifyingTripIds.map((tripId) => (
                            <Pressable key={tripId} style={styles.checklistRow} onPress={() => router.push({ pathname: '/trip', params: { tripId } })}>
                                <Ionicons name="checkmark-circle" size={22} color="#3d9a5c" />
                                <Text style={styles.checklistLabel}>
                                    {tripDates[tripId] ? new Date(tripDates[tripId]).toLocaleDateString() : tripId}
                                </Text>
                                <Ionicons name="chevron-forward" size={16} color="#ccc" />
                            </Pressable>
                        ))
                    )}
                </View>
            );

        case 'counting': {
            // No second progress bar here -- the hero section above already
            // shows this exact current/target (they're the same number by
            // construction), and the medal row shows which tiers are already
            // earned. This block only adds what the hero can't: which line
            // the count is tracking (ride_count_route) and a tappable list of
            // every trip that contributed, same row style as the Profile
            // page's Trip History.
            const routeId = breakdown.contributingRoute;
            const routeNavigable = routeId !== null && isNavigableRoute(normalizeRouteIdForIcon(routeId));
            const goToLine = routeNavigable ? () => router.push(`/line/${normalizeRouteIdForIcon(routeId)}`) : null;
            return (
                <View style={styles.countingBlock}>
                    {routeId && (
                        goToLine ? (
                            <Pressable style={styles.checklistRow} onPress={goToLine}>
                                <RouteIcon routeId={routeId} onPress={null} size={28} />
                                <Text style={[styles.checklistLabel, styles.checklistTextWrap]}>{routeId} line</Text>
                                <Ionicons name="chevron-forward" size={16} color="#ccc" />
                            </Pressable>
                        ) : (
                            <View style={styles.checklistRow}>
                                <RouteIcon routeId={routeId} onPress={null} size={28} />
                                <Text style={styles.checklistLabel}>{routeId} line</Text>
                            </View>
                        )
                    )}
                    <SectionHeader title="Qualifying Trips" />
                    {breakdown.qualifyingTrips.length === 0 ? (
                        <Text style={styles.emptyText}>No trips yet.</Text>
                    ) : (
                        breakdown.qualifyingTrips.map((t) => <TripHistoryRow key={t.tripId} {...t} />)
                    )}
                </View>
            );
        }
    }
}

// One row for EVERY defined tier (not just reached ones) -- gold + filled
// ribbon for a tier already reached, gray + outline ribbon for one not yet
// reached, same done/pending color convention as everywhere else on this
// page (ChecklistRow's checkmark-circle green vs. ellipse-outline gray).
// Reuses the same ribbon glyph as the hero icon above the quest title,
// rather than a different medal icon, so a tiered quest's trophy case reads
// as "a row of the same achievement icon, one per milestone." The cutoff
// number sits in a small circle nudged down-and-right of the ribbon's
// center (not dead-center) so it reads as a badge pinned to the medal
// rather than text stamped through it, and the white circle gives it
// contrast against the ribbon's own fill color. Horizontal-scrolls rather
// than wrapping -- a tiered quest with many rungs still fits on one line for
// most quests, and scrolling avoids the hero section's height jumping
// around as more tiers are earned.
// The badge grows from a circle (1-2 digit tiers) into a pill (3-digit
// tiers like 100/500) since a fixed-size circle can't hold "500" without
// clipping or off-center text. Its own width/height is measured via
// onLayout (RN gives no other way to know rendered size ahead of paint) and
// fed back in as an exact -width/2/-height/2 translate, so the badge's
// CENTER lands on the anchor point regardless of how wide the pill grows --
// a fixed translate tuned for the 2-digit case would drift off-center for
// 3-digit values, which is exactly the bug this fixes.
function MedalBadge({ value, done }: { value: number; done: boolean }) {
    const [size, setSize] = useState({ width: 18, height: 18 });
    return (
        <View
            onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
            }}
            style={[
                styles.medalBadge,
                done ? styles.medalBadgeDone : styles.medalBadgePending,
                { transform: [{ translateX: -size.width / 2 }, { translateY: -size.height / 2 }] },
            ]}
        >
            <Text style={[styles.medalNumber, done ? styles.medalNumberDone : styles.medalNumberPending]}>{value}</Text>
        </View>
    );
}

function MedalRow({ tiers, tierIndex }: { tiers: number[]; tierIndex: number }) {
    if (tiers.length === 0) return null;
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.medalScroll} contentContainerStyle={styles.medalRow}>
            {tiers.map((t, i) => {
                const done = i < tierIndex;
                return (
                    <View key={t} style={styles.medalWrap}>
                        <Ionicons name={done ? 'ribbon' : 'ribbon-outline'} size={40} color={done ? '#c9962c' : '#999'} />
                        <MedalBadge value={t} done={done} />
                    </View>
                );
            })}
        </ScrollView>
    );
}

// A tiered quest's status badge shouldn't say "Completed" the moment the
// first tier is reached while the progress bar right underneath still reads
// e.g. "31 of 50" -- that reads as contradictory. Once a quest has at least
// one tier done but isn't maxed, show which rung it's on instead; "Completed"
// is reserved for every tier reached (or, for non-counting quests, the
// original binary completed flag).
function statusLabel(quest: QuestDetail): string {
    if (quest.breakdown.kind === 'counting') {
        const { tierIndex, tiers } = quest.breakdown;
        if (tierIndex === 0) return 'In progress';
        if (tierIndex === tiers.length) return 'Completed';
        return `Tier ${tierIndex} of ${tiers.length}`;
    }
    return quest.completed ? 'Completed' : 'In progress';
}

export default function AchievementDetailScreen() {
    const { questId } = useLocalSearchParams<{ questId: string }>();
    const db = useDb();
    const userId = useUserId();
    const insets = useSafeAreaInsets();
    const [quest, setQuest] = useState<QuestDetail | null | undefined>(undefined); // undefined = loading

    useEffect(() => {
        (async () => {
            setQuest(await getQuestDetail(db, userId, questId));
        })();
    }, [db, userId, questId]);

    if (quest === undefined) return <View style={styles.centered}><ActivityIndicator /></View>;
    if (quest === null) return <View style={styles.centered}><Text style={styles.label}>Achievement not found.</Text></View>;

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable onPress={() => router.back()} accessibilityLabel="Back">
                    <Ionicons name="chevron-back" size={26} color="#111" />
                </Pressable>
            </View>

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 24 }]}>
                <View style={styles.hero}>
                    <Ionicons
                        name={quest.completed ? 'ribbon' : 'ribbon-outline'}
                        size={56}
                        color={quest.completed ? '#c9962c' : '#999'}
                    />
                    <Text style={styles.questTitle}>{quest.title}</Text>
                    <Text style={styles.description}>{quest.description}</Text>

                    {quest.breakdown.kind === 'counting' && (
                        <MedalRow tiers={quest.breakdown.tiers} tierIndex={quest.breakdown.tierIndex} />
                    )}

                    <View style={[styles.statusBadge, quest.completed ? styles.statusBadgeDone : styles.statusBadgePending]}>
                        <Text style={[styles.statusBadgeText, quest.completed ? styles.statusBadgeTextDone : styles.statusBadgeTextPending]}>
                            {statusLabel(quest)}
                        </Text>
                    </View>

                    {quest.current !== null && quest.target !== null && (
                        <View style={styles.heroProgress}>
                            <ProgressBar
                                current={quest.current}
                                target={quest.target}
                                size="large"
                                ticks={quest.breakdown.kind === 'counting' ? quest.breakdown.tiers : undefined}
                            />
                        </View>
                    )}
                </View>

                <View style={styles.breakdownSection}>
                    <BreakdownList quest={quest} />
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    label: { fontSize: 15, color: '#444' },
    content: { padding: 24, gap: 24 },
    hero: { alignItems: 'center', gap: 10 },
    questTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: 4 },
    description: { fontSize: 15, color: '#555', textAlign: 'center' },
    statusBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, marginTop: 8 },
    statusBadgeDone: { backgroundColor: '#fdf6e8' },
    statusBadgePending: { backgroundColor: '#f0f0f0' },
    statusBadgeText: { fontSize: 13, fontWeight: '700' },
    statusBadgeTextDone: { color: '#8a6d1f' },
    statusBadgeTextPending: { color: '#888' },
    heroProgress: { width: '100%', marginTop: 8 },
    medalScroll: { width: '100%', flexGrow: 0, marginTop: 2 },
    medalRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 4, justifyContent: 'center', flexGrow: 1 },
    medalWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    // Anchor point is down-and-right of dead-center on the ribbon icon (top
    // 50%, left 50% would be dead-center) -- right-shifted further than
    // down since a purely-diagonal offset read as too close to center once
    // rendered. Component-level onLayout then translates back by exactly
    // half the badge's own measured size, so this anchor point becomes the
    // badge's center, not its corner.
    medalBadge: {
        position: 'absolute', top: '58%', left: '72%',
        minWidth: 18, minHeight: 18, borderRadius: 999,
        paddingHorizontal: 4,
        backgroundColor: '#fff',
        borderWidth: 1.5,
        alignItems: 'center', justifyContent: 'center',
    },
    medalBadgeDone: { borderColor: '#c9962c' },
    medalBadgePending: { borderColor: '#999' },
    medalNumber: { fontSize: 9, fontWeight: '800' },
    medalNumberDone: { color: '#c9962c' },
    medalNumberPending: { color: '#999' },
    breakdownSection: { gap: 4 },
    groupSection: { marginBottom: 8 },
    groupBlock: { marginTop: 10, marginBottom: 4, gap: 6 },
    countingBlock: { gap: 6, paddingVertical: 8 },
    groupHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    groupHeader: { fontSize: 13, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3 },
    checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    checklistTextWrap: { flex: 1 },
    checklistLabel: { fontSize: 15, color: '#222', fontWeight: '600' },
    checklistLabelPending: { color: '#888', fontWeight: '400' },
    checklistSublabel: { fontSize: 12, color: '#999', marginTop: 1 },
    trailingRouteIcons: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flexShrink: 0 },
    emptyText: { fontSize: 14, color: '#666', textAlign: 'center' },
});

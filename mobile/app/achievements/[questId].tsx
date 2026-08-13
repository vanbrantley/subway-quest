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
            // construction). This block only adds what the hero can't:
            // which line the count is tracking (ride_count_route with
            // route: 'any' picks your most-ridden line, otherwise ambiguous
            // from the number alone) and which trips contributed.
            const label = formatTripsLabel(breakdown.contributingTripIds, tripDates);
            return (
                <View style={styles.countingBlock}>
                    {breakdown.contributingRoute && (
                        <View style={styles.checklistRow}>
                            <RouteIcon routeId={breakdown.contributingRoute} onPress={null} size={28} />
                            <Text style={styles.checklistLabel}>{breakdown.contributingRoute} line</Text>
                        </View>
                    )}
                    {label && <Text style={styles.checklistSublabel}>{label}</Text>}
                </View>
            );
        }
    }
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

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.hero}>
                    <Ionicons
                        name={quest.completed ? 'ribbon' : 'ribbon-outline'}
                        size={56}
                        color={quest.completed ? '#c9962c' : '#999'}
                    />
                    <Text style={styles.questTitle}>{quest.title}</Text>
                    <Text style={styles.description}>{quest.description}</Text>

                    <View style={[styles.statusBadge, quest.completed ? styles.statusBadgeDone : styles.statusBadgePending]}>
                        <Text style={[styles.statusBadgeText, quest.completed ? styles.statusBadgeTextDone : styles.statusBadgeTextPending]}>
                            {quest.completed ? 'Completed' : 'In progress'}
                        </Text>
                    </View>

                    {quest.current !== null && quest.target !== null && (
                        <View style={styles.heroProgress}>
                            <ProgressBar current={quest.current} target={quest.target} size="large" />
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

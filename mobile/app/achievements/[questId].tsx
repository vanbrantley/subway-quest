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
import { LINE_ICONS } from '../../constants/lineIcons';
import { LINE_COLORS } from '../../constants/lineColors';
import { getQuestDetail, type QuestDetail } from '../../db/quests';
import { ProgressBar } from '../../components/ui/ProgressBar';

function formatTripsLabel(tripIds: string[], tripDates: Record<string, string>): string | null {
    if (tripIds.length === 0) return null;
    const dates = tripIds.map((id) => tripDates[id]).filter(Boolean).sort();
    if (dates.length === 0) return null;
    const first = new Date(dates[0]).toLocaleDateString();
    return dates.length === 1 ? `Visited ${first}` : `Visited ${first} (+${dates.length - 1} more)`;
}

function ChecklistRow({ visited, label, sublabel }: { visited: boolean; label: string; sublabel: string | null }) {
    return (
        <View style={styles.checklistRow}>
            <Ionicons
                name={visited ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={visited ? '#3d9a5c' : '#ccc'}
            />
            <View style={styles.checklistTextWrap}>
                <Text style={[styles.checklistLabel, !visited && styles.checklistLabelPending]}>{label}</Text>
                {sublabel && <Text style={styles.checklistSublabel}>{sublabel}</Text>}
            </View>
        </View>
    );
}

function BreakdownList({ quest }: { quest: QuestDetail }) {
    const { breakdown, tripDates } = quest;

    switch (breakdown.kind) {
        case 'stations':
            return (
                <>
                    {breakdown.items.map((item) => (
                        <ChecklistRow
                            key={item.complexId}
                            visited={item.visited}
                            label={item.name}
                            sublabel={formatTripsLabel(item.tripIds, tripDates)}
                        />
                    ))}
                </>
            );

        case 'groups':
            return (
                <>
                    {breakdown.items.map((item) => {
                        if (item.minRequired <= 1) {
                            // OR semantics (boroughs, branch tails) -- any one member
                            // is enough, so a single collapsed row is sufficient
                            const visitedIndex = item.complexIds.findIndex((cid) => item.visitedComplexIds.includes(cid));
                            return (
                                <ChecklistRow
                                    key={item.groupIndex}
                                    visited={item.visited}
                                    label={visitedIndex >= 0 ? item.names[visitedIndex] : item.names.join(' or ')}
                                    sublabel={formatTripsLabel(item.tripIds, tripDates)}
                                />
                            );
                        }
                        // AND-style semantics (Déjà Vu: need 2+ of this same-name
                        // cluster) -- show every member individually so it's clear
                        // exactly which ones are done and which remain. Matched by
                        // complexId, NOT name -- every member of a same-name cluster
                        // shares the literal same name string, so name-matching can't
                        // tell them apart (real bug found on-device: every row showed
                        // checked the moment just one was visited).
                        return (
                            <View key={item.groupIndex} style={styles.groupBlock}>
                                <Text style={styles.groupHeader}>{item.names[0]}</Text>
                                <ProgressBar current={item.visitedComplexIds.length} target={item.minRequired} />
                                {item.complexIds.map((cid, i) => (
                                    <ChecklistRow key={cid} visited={item.visitedComplexIds.includes(cid)} label={item.names[i]} sublabel={null} />
                                ))}
                            </View>
                        );
                    })}
                </>
            );

        case 'pairs':
            return (
                <>
                    {breakdown.items.map((item) => (
                        <ChecklistRow
                            key={`${item.station}-${item.route}`}
                            visited={item.visited}
                            label={`${item.stationName} (${item.route})`}
                            sublabel={formatTripsLabel(item.tripIds, tripDates)}
                        />
                    ))}
                </>
            );

        case 'routes':
            return (
                <>
                    {breakdown.items.map((item) => {
                        const Icon = LINE_ICONS[item.route];
                        return (
                            <View key={item.route} style={styles.checklistRow}>
                                <Ionicons
                                    name={item.visited ? 'checkmark-circle' : 'ellipse-outline'}
                                    size={22}
                                    color={item.visited ? '#3d9a5c' : '#ccc'}
                                />
                                {Icon ? <Icon width={24} height={24} /> : (
                                    <View style={[styles.routeDot, { backgroundColor: LINE_COLORS[item.route]?.bg ?? '#ccc' }]}>
                                        <Text style={styles.routeDotText}>{item.route}</Text>
                                    </View>
                                )}
                                <View style={styles.checklistTextWrap}>
                                    {formatTripsLabel(item.tripIds, tripDates) && (
                                        <Text style={styles.checklistSublabel}>{formatTripsLabel(item.tripIds, tripDates)}</Text>
                                    )}
                                </View>
                            </View>
                        );
                    })}
                </>
            );

        case 'per_trip':
            return breakdown.qualifyingTripIds.length === 0 ? (
                <Text style={styles.emptyText}>No trip has satisfied this yet.</Text>
            ) : (
                <>
                    {breakdown.qualifyingTripIds.map((tripId) => (
                        <Pressable key={tripId} style={styles.checklistRow} onPress={() => router.push({ pathname: '/trip', params: { tripId } })}>
                            <Ionicons name="checkmark-circle" size={22} color="#3d9a5c" />
                            <Text style={styles.checklistLabel}>
                                {tripDates[tripId] ? new Date(tripDates[tripId]).toLocaleDateString() : tripId}
                            </Text>
                        </Pressable>
                    ))}
                </>
            );

        case 'counting': {
            const label = formatTripsLabel(breakdown.contributingTripIds, tripDates);
            return (
                <View style={styles.countingBlock}>
                    <ProgressBar current={breakdown.current} target={breakdown.target} />
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
                <Text style={styles.title}>Achievement</Text>
                <View style={{ width: 26 }} />
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
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    title: { fontSize: 17, fontWeight: '600' },
    label: { fontSize: 15, color: '#444' },
    content: { padding: 24, gap: 24 },
    hero: { alignItems: 'center', gap: 10 },
    questTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
    description: { fontSize: 15, color: '#555', textAlign: 'center' },
    statusBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, marginTop: 8 },
    statusBadgeDone: { backgroundColor: '#fdf6e8' },
    statusBadgePending: { backgroundColor: '#f0f0f0' },
    statusBadgeText: { fontSize: 13, fontWeight: '700' },
    statusBadgeTextDone: { color: '#8a6d1f' },
    statusBadgeTextPending: { color: '#888' },
    heroProgress: { width: '100%', marginTop: 8 },
    breakdownSection: { gap: 4 },
    groupBlock: { marginTop: 10, marginBottom: 4, gap: 6 },
    countingBlock: { gap: 6, paddingVertical: 8 },
    groupHeader: { fontSize: 13, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
    checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    checklistTextWrap: { flex: 1 },
    checklistLabel: { fontSize: 15, color: '#222', fontWeight: '600' },
    checklistLabelPending: { color: '#888', fontWeight: '400' },
    checklistSublabel: { fontSize: 12, color: '#999', marginTop: 1 },
    emptyText: { fontSize: 14, color: '#666', textAlign: 'center' },
    routeDot: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    routeDotText: { fontSize: 10, fontWeight: '700' },
});
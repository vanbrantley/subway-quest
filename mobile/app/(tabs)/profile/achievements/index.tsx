// mobile/app/(tabs)/profile/achievements/index.tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDb } from '../../../../contexts/DatabaseContext';
import { useUserId } from '../../../../contexts/AuthContext';
import { getAllQuestProgress, type QuestSummary } from '../../../../db/quests';
import { ProgressBar } from '../../../../components/ui/ProgressBar';

export default function AchievementsListScreen() {
    const db = useDb();
    const userId = useUserId();
    const insets = useSafeAreaInsets();
    const [quests, setQuests] = useState<QuestSummary[] | null>(null);

    useEffect(() => {
        (async () => {
            setQuests(await getAllQuestProgress(db, userId));
        })();
    }, [db, userId]);

    if (!quests) return <View style={styles.centered}><ActivityIndicator /></View>;

    const completed = quests.filter((q) => q.completed);
    const ongoing = quests.filter((q) => !q.completed);

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable onPress={() => router.back()} accessibilityLabel="Back">
                    <Ionicons name="chevron-back" size={26} color="#111" />
                </Pressable>
                <Text style={styles.title}>Achievements</Text>
                <View style={{ width: 26 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.sectionTitle}>Completed ({completed.length})</Text>
                {completed.length === 0 ? (
                    <Text style={styles.emptyText}>None yet -- get out there.</Text>
                ) : (
                    completed.map((q) => <QuestRow key={q.questId} quest={q} />)
                )}

                <Text style={[styles.sectionTitle, styles.sectionSpacer]}>Ongoing ({ongoing.length})</Text>
                {ongoing.map((q) => <QuestRow key={q.questId} quest={q} />)}
            </ScrollView>
        </View>
    );
}

function QuestRow({ quest }: { quest: QuestSummary }) {
    return (
        <Pressable
            style={styles.row}
            onPress={() => router.push(`/achievements/${quest.questId}`)}
        >
            <Ionicons
                name={quest.completed ? 'ribbon' : 'ribbon-outline'}
                size={24}
                color={quest.completed ? '#c9962c' : '#999'}
            />
            <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{quest.title}</Text>
                {/* current/target is only meaningful for lifetime_set/counting quests --
                    per_trip quests (current === null) show no fraction, just the icon
                    state above, matching quests_logic.ts's QuestProgress doc comment:
                    "the UI shows those as a checklist/badge, not a fraction." */}
                {quest.current !== null && quest.target !== null && (
                    <ProgressBar current={quest.current} target={quest.target} />
                )}
            </View>
            <Ionicons name="chevron-forward" size={18} color="#ccc" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    title: { fontSize: 17, fontWeight: '600' },
    content: { padding: 20, gap: 10 },
    sectionTitle: { fontSize: 14, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 },
    sectionSpacer: { marginTop: 20 },
    emptyText: { fontSize: 14, color: '#999', fontStyle: 'italic' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    rowText: { flex: 1, gap: 4 },
    rowTitle: { fontSize: 16, fontWeight: '600', color: '#222' },
});
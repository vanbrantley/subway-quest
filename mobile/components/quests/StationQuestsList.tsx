// mobile/components/quests/StationQuestsList.tsx
//
// "Quests this station contributes to" -- reused wherever a station is
// shown (canonical Station page, milestone 9). Self-contained: fetches its
// own data given just a complex_id, so mounting it anywhere is a one-line
// drop-in (see docs/quests-integration.md once milestone 9 wires this in
// for real). Fully built and tested now, per milestone-8-achievements.md's
// scope -- not mounted anywhere yet, since no Station page exists.

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDb } from '../../contexts/DatabaseContext';
import { useUserId } from '../../contexts/AuthContext';
import { getQuestsForStation, type QuestSummary } from '../../db/quests';

export function StationQuestsList({ complexId }: { complexId: number }) {
    const db = useDb();
    const userId = useUserId();
    const [quests, setQuests] = useState<QuestSummary[] | null>(null); // null = loading

    useEffect(() => {
        (async () => {
            setQuests(await getQuestsForStation(db, userId, complexId));
        })();
    }, [db, userId, complexId]);

    if (quests === null) return <ActivityIndicator style={styles.loading} />;
    // A station with no quest attached renders nothing -- most stations
    // won't be part of a quest, and an empty "Quests at this station"
    // section on every plain station page would be noise, not information.
    if (quests.length === 0) return null;

    return (
        <View style={styles.container}>
            <Text style={styles.header}>Quests at this station</Text>
            {quests.map((q) => (
                <Pressable
                    key={q.questId}
                    style={styles.row}
                    onPress={() => router.push(`/achievements/${q.questId}`)}
                >
                    <Ionicons
                        name={q.completed ? 'ribbon' : 'ribbon-outline'}
                        size={20}
                        color={q.completed ? '#c9962c' : '#999'}
                    />
                    <View style={styles.rowText}>
                        <Text style={styles.rowTitle}>{q.title}</Text>
                        {q.current !== null && q.target !== null && (
                            <Text style={styles.rowProgress}>{q.current} / {q.target}</Text>
                        )}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#ccc" />
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    loading: { marginVertical: 12 },
    container: { gap: 8 },
    header: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    rowText: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: '600', color: '#222' },
    rowProgress: { fontSize: 12, color: '#999', marginTop: 1 },
});
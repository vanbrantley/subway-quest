// mobile/components/quests/ProfileQuestsSummary.tsx
//
// "Achievements summary (completed/ongoing counts), with a link into the
// full Achievements page" -- Profile tab's mini-dashboard section (see
// ui-spec.md's Profile tab spec). Self-contained, no props needed. Fully
// built and tested now, per milestone-8-achievements.md's scope -- not
// mounted anywhere yet, since Profile's real dashboard is milestone 9.

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDb } from '../../contexts/DatabaseContext';
import { useUserId } from '../../contexts/AuthContext';
import { getAllQuestProgress } from '../../db/quests';

export function ProfileQuestsSummary() {
    const db = useDb();
    const userId = useUserId();
    const [counts, setCounts] = useState<{ completed: number; total: number } | null>(null);

    useEffect(() => {
        (async () => {
            const all = await getAllQuestProgress(db, userId);
            setCounts({ completed: all.filter((q) => q.completed).length, total: all.length });
        })();
    }, [db, userId]);

    if (counts === null) return <ActivityIndicator style={styles.loading} />;

    return (
        <Pressable style={styles.container} onPress={() => router.push('/profile/achievements')}>
            <View style={styles.iconWrap}>
                <Ionicons name="ribbon" size={24} color="#c9962c" />
            </View>
            <View style={styles.textWrap}>
                <Text style={styles.title}>Achievements</Text>
                <Text style={styles.subtitle}>{counts.completed} of {counts.total} completed</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#ccc" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    loading: { marginVertical: 12 },
    container: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fdf6e8', justifyContent: 'center', alignItems: 'center' },
    textWrap: { flex: 1 },
    title: { fontSize: 16, fontWeight: '700', color: '#222' },
    subtitle: { fontSize: 13, color: '#888', marginTop: 1 },
});
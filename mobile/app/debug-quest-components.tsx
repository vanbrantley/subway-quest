// mobile/app/debug-quest-components.tsx
//
// TEMPORARY, __DEV__-gated -- mounts StationQuestsList and ProfileQuestsSummary
// against real data so they can be verified on-device before the Station and
// Profile pages that will actually host them exist (milestone 9). Same
// scaffolding-to-remove-later pattern as debug.tsx's own temporary Profile
// button. Delete this file once milestone 9 mounts both components for real
// -- see docs/quests-integration.md for the exact insertion points.

import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileQuestsSummary } from '../components/quests/ProfileQuestsSummary';
import { StationQuestsList } from '../components/quests/StationQuestsList';

// A handful of real, known complex_ids covering different criteria shapes,
// for spot-checking StationQuestsList against real quest data. Not meant to
// be exhaustive -- just enough variety to confirm rendering, progress
// fractions, and navigation all work correctly.
const TEST_STATIONS = [
    { complexId: 222, label: 'Roosevelt Island (single-station quest)' },
    { complexId: 611, label: 'Times Sq (crossroads route pairs)' },
    { complexId: 58, label: 'Coney Island-Stillwell Av (Beachy, min-count)' },
];

export default function DebugQuestComponentsScreen() {
    const insets = useSafeAreaInsets();
    if (!__DEV__) return null;

    return (
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
            <Text style={styles.warning}>TEMP DEBUG SCREEN — remove once milestone 9 mounts these for real</Text>

            <Text style={styles.sectionLabel}>ProfileQuestsSummary</Text>
            <ProfileQuestsSummary />

            {TEST_STATIONS.map((s) => (
                <View key={s.complexId}>
                    <Text style={styles.sectionLabel}>StationQuestsList — {s.label}</Text>
                    <StationQuestsList complexId={s.complexId} />
                </View>
            ))}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    content: { padding: 20, gap: 20, paddingBottom: 60 },
    warning: { fontSize: 12, color: '#c0392b', fontWeight: '700', textAlign: 'center' },
    sectionLabel: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', marginBottom: 8 },
});
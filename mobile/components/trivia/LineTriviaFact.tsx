// mobile/components/trivia/LineTriviaFact.tsx
//
// A line's trivia fact -- collapsed behind a tappable pill, same behavior as
// StationTriviaFact.tsx (just scoped to a route_id instead of a complex_id).
// Whether the pill is expanded is plain local state, NOT persisted -- see
// StationTriviaFact.tsx's header comment for why.

import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTriviaPreferences } from '../../contexts/TriviaPreferencesContext';
import { getLineTrivia } from '../../lib/subwayData';
import { TriviaSparkleToggle } from './TriviaSparkleToggle';

export function LineTriviaFact({ routeId }: { routeId: string }) {
    const { factsEnabled, loading: factsLoading } = useTriviaPreferences();
    const fact = getLineTrivia(routeId);
    const [expanded, setExpanded] = useState(false);

    if (!fact || factsLoading || !factsEnabled) return null;

    function toggle() {
        setExpanded((prev) => !prev);
    }

    return (
        <View style={styles.container}>
            <Pressable style={styles.chip} onPress={toggle}>
                <TriviaSparkleToggle active={expanded} onPress={toggle} />
                <Text style={styles.chipText}>Fun fact</Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#999" />
            </Pressable>
            {expanded && <Text style={styles.factText}>{fact}</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { gap: 8, marginTop: 16, marginBottom: 16 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#f5f5f5' },
    chipText: { fontSize: 13, fontWeight: '700', color: '#666' },
    factText: { fontSize: 15, color: '#333', lineHeight: 20 },
});

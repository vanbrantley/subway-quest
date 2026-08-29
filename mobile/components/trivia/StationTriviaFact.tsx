// mobile/components/trivia/StationTriviaFact.tsx
//
// A station's trivia fact -- shown whenever one exists (no more visit-gating:
// browsing to any station's page should surface its fact, to encourage
// exploration), subject only to the global Fun Facts switch. Collapsed
// behind a tappable pill, same "see it once and know it" behavior as
// LineTriviaFact.tsx. Whether the pill is expanded is plain local state, NOT
// persisted -- every fresh visit to this station's page starts collapsed
// again; tapping only affects that one viewing. (An earlier version
// remembered this per station/user via a synced table -- removed as
// unnecessary complexity once the pill itself already made a fact's default
// footprint small enough that "remembering you looked once" wasn't worth
// persisting.)

import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTriviaPreferences } from '../../contexts/TriviaPreferencesContext';
import { getStationTrivia } from '../../lib/subwayData';
import { TriviaSparkleToggle } from './TriviaSparkleToggle';

export function StationTriviaFact({ complexId }: { complexId: number }) {
    const { factsEnabled, loading: factsLoading } = useTriviaPreferences();
    const fact = getStationTrivia(complexId);
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
    container: { gap: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#f5f5f5' },
    chipText: { fontSize: 13, fontWeight: '700', color: '#666' },
    factText: { fontSize: 15, color: '#333', lineHeight: 20 },
});

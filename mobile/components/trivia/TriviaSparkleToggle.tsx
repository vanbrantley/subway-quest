// mobile/components/trivia/TriviaSparkleToggle.tsx
//
// Presentational-only sparkle button -- no DB/context access -- shared by
// StationTriviaFact/LineTriviaFact so the show/hide control looks identical
// on both pages while those two stay independently self-contained (each
// owns its own data fetch, per this codebase's existing convention).
// Colored when the fact is currently visible, grey when hidden -- doubles as
// the Line page's disclosure trigger and both pages' persisted toggle.

import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function TriviaSparkleToggle({
    active, onPress, disabled, size = 18,
}: { active: boolean; onPress: () => void; disabled?: boolean; size?: number }) {
    return (
        <Pressable onPress={onPress} disabled={disabled} hitSlop={8}>
            <Ionicons name="sparkles" size={size} color={active ? '#c9962c' : '#c7c7c7'} />
        </Pressable>
    );
}

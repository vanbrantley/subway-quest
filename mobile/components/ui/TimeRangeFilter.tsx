// mobile/components/ui/TimeRangeFilter.tsx
// Shared 3-pill segmented time-range control -- used independently by
// FavoritesCharts and TripHistoryList (each owns its own range state; this
// component is stateless).
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { TimeRange } from '../../lib/dateMath';

const OPTIONS: { value: TimeRange; label: string }[] = [
    { value: 'all', label: 'All time' },
    { value: '30d', label: '30 days' },
    { value: '7d', label: 'Week' },
];

type Props = { value: TimeRange; onChange: (range: TimeRange) => void };

export function TimeRangeFilter({ value, onChange }: Props) {
    return (
        <View style={styles.row}>
            {OPTIONS.map((opt) => {
                const active = opt.value === value;
                return (
                    <Pressable
                        key={opt.value}
                        style={[styles.pill, active && styles.pillActive]}
                        onPress={() => onChange(opt.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                    >
                        <Text style={[styles.pillText, active && styles.pillTextActive]}>{opt.label}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#f5f5f5' },
    pillActive: { backgroundColor: '#2e9e52' },
    pillText: { fontSize: 12, fontWeight: '600', color: '#666' },
    pillTextActive: { color: '#fff' },
});

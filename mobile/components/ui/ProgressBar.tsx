// mobile/components/ui/ProgressBar.tsx
// Shared "current of target" visual, replacing every plain-text N/M fraction
// display across Profile/Achievements/Station/Line/Trip pages with one
// component instead of a copy-pasted string per screen.
import { View, Text, StyleSheet } from 'react-native';

type ProgressBarProps = {
    current: number;
    target: number;
    label?: string;
    completed?: boolean; // defaults to current >= target
    size?: 'default' | 'large';
};

export function ProgressBar({ current, target, label, completed, size = 'default' }: ProgressBarProps) {
    const isComplete = completed ?? current >= target;
    const pct = target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : 100;
    const isLarge = size === 'large';

    return (
        <View style={styles.wrap}>
            {label && <Text style={styles.label}>{label}</Text>}
            <View style={[styles.track, isLarge && styles.trackLarge]}>
                <View style={[styles.fill, isLarge && styles.trackLarge, { width: `${pct}%` }]} />
            </View>
            <Text style={[styles.fraction, isLarge && styles.fractionLarge]}>
                {isComplete ? 'Completed!' : `${current} of ${target}`}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { gap: 4 },
    label: { fontSize: 13, color: '#666' },
    track: { height: 8, borderRadius: 4, backgroundColor: '#e8e8e8', overflow: 'hidden' },
    trackLarge: { height: 12, borderRadius: 6 },
    fill: { height: 8, borderRadius: 4, backgroundColor: '#2e9e52' },
    fraction: { fontSize: 13, color: '#444', fontWeight: '600' },
    fractionLarge: { fontSize: 15 },
});

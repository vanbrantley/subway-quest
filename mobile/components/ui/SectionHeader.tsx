// mobile/components/ui/SectionHeader.tsx
// The small-caps gray section-header style every page has independently
// converged on (Station's groupLabel, Profile's sectionHeader, Line's
// groupLabel, achievements-list's sectionTitle) -- extracted once so new
// pages don't reimplement it a fifth time.
import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

// `style` is opt-in on top of the base look -- achievements/[questId].tsx's
// content container already applies its own `gap: 24` between children, so
// this component's own default margins must stay small; Profile's content
// container instead uses a small `gap: 4` and relies on each header's own
// top margin for section spacing (see profile/index.tsx's `sectionSpacing`
// usage), which a shared default here can't universally assume.
export function SectionHeader({ title, style }: { title: string; style?: StyleProp<TextStyle> }) {
    return <Text style={[styles.header, style]}>{title}</Text>;
}

const styles = StyleSheet.create({
    header: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 10 },
});

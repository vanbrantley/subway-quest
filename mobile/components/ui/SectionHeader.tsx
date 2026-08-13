// mobile/components/ui/SectionHeader.tsx
// The small-caps gray section-header style every page has independently
// converged on (Station's groupLabel, Profile's sectionHeader, Line's
// groupLabel, achievements-list's sectionTitle) -- extracted once so new
// pages don't reimplement it a fifth time.
import { Text, StyleSheet } from 'react-native';

export function SectionHeader({ title }: { title: string }) {
    return <Text style={styles.header}>{title}</Text>;
}

const styles = StyleSheet.create({
    header: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 10 },
});

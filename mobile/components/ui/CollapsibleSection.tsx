// mobile/components/ui/CollapsibleSection.tsx
// A tappable section header that shows/hides its own body -- for long lists
// (Borough/Neighborhood pages' Neighborhoods/Stations sections) that would
// otherwise force scrolling past every row just to reach whatever comes
// after them (e.g. Visit History). Starts open (full list visible) but can
// be collapsed to skip straight down the page.
import { useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function CollapsibleSection({
    title, count, defaultExpanded = true, children,
}: {
    title: string;
    count?: number;
    defaultExpanded?: boolean;
    children: ReactNode;
}) {
    const [expanded, setExpanded] = useState(defaultExpanded);

    return (
        <View style={styles.section}>
            <Pressable style={styles.header} onPress={() => setExpanded((e) => !e)}>
                <Text style={styles.title}>{title}{count !== undefined ? ` (${count})` : ''}</Text>
                <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={16} color="#888" />
            </Pressable>
            {expanded && <View style={styles.body}>{children}</View>}
        </View>
    );
}

const styles = StyleSheet.create({
    section: { marginTop: 12 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
    title: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3 },
    body: { marginTop: 4 },
});

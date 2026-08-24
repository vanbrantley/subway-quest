// mobile/components/LogTripFAB.tsx
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export function LogTripFAB() {
    return (
        <Pressable
            style={styles.fab}
            onPress={() => router.push('/log-trip')}
            accessibilityLabel="Log a trip"
        >
            <Ionicons name="add" size={32} color="#fff" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    fab: {
        position: 'absolute',
        right: 24,
        // CustomTabBar is a real in-flow sibling of the root Stack (see components/CustomTabBar.tsx),
        // so it already shrinks this screen's own available height by the bar's full height -- this
        // container's bottom edge now lands right at the bar's top edge. Just needs a small gap above
        // that, not the old bar's full height on top of it again.
        bottom: 16,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#111',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 4, // Android shadow equivalent
    },
});
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
        bottom: 96, // sits above the tab bar, doesn't overlap it
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
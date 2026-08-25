// mobile/components/map/LocationButton.tsx
//
// Floating "center on my location" button. Same size as LogTripFAB, stacked
// directly above it in a single right-edge column -- the conventional map-app
// layout (recenter control above the primary FAB), and keeps both
// thumb-reachable without eating into map width. (LogTripFAB: bottom:16,
// right:24, 56pt -- see components/LogTripFAB.tsx, mounted globally in
// (tabs)/_layout.tsx.)
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
    active: boolean;
    onPress: () => void;
};

export function LocationButton({ active, onPress }: Props) {
    return (
        <Pressable style={styles.button} onPress={onPress} accessibilityLabel="Center on my location">
            <Ionicons name={active ? 'locate' : 'locate-outline'} size={26} color="#111" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: {
        position: 'absolute',
        right: 24,
        // 16 (FAB's own bottom offset) + 56 (FAB height) + 12 (gap)
        bottom: 84,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#fff',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 4,
    },
});

// mobile/components/DevModeBadge.tsx
// Small persistent "DEV MODE" pill, rendered only when IS_DEV_MODE -- so
// it's always obvious which build is running (test data included, will
// never reach a real production account's history). Mounted at the root
// layout, not just inside (tabs), so it's visible on the sign-in screen
// too -- same "always-visible overlay sibling" pattern LogTripFAB already
// uses one level down.
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IS_DEV_MODE } from '../lib/devMode';

export function DevModeBadge() {
    const insets = useSafeAreaInsets();
    if (!IS_DEV_MODE) return null;
    return (
        <View style={[styles.badge, { top: insets.top + 6 }]} pointerEvents="none">
            <Text style={styles.text}>DEV MODE</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    badge: {
        position: 'absolute',
        alignSelf: 'center',
        zIndex: 999,
        backgroundColor: '#d9534f',
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 10,
    },
    text: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
});

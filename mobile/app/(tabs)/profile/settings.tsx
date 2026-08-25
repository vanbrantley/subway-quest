// mobile/app/(tabs)/profile/settings.tsx
// Reached only from Profile's gear icon -- stays nested under profile/ per
// status.md's router rules (root-level is only required for a screen
// reached from more than one context, e.g. station/[stationId].tsx).
import { View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { IS_DEV_MODE } from '../../../lib/devMode';
import { usePermissionStatus, type PermissionStatus } from '../../../lib/location';

// The persistent way to revisit the one-time Map-tab location prompt -- iOS
// only shows its own system dialog once per install, so any later change of
// mind (either direction) has to go through the app's own Settings page.
const LOCATION_STATUS_LABEL: Record<PermissionStatus, string> = {
    granted: 'On',
    denied: 'Off',
    undetermined: 'Not Set',
};

export default function SettingsScreen() {
    const insets = useSafeAreaInsets();
    const location = usePermissionStatus();

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable onPress={() => router.back()} accessibilityLabel="Back">
                    <Ionicons name="chevron-back" size={26} color="#111" />
                </Pressable>
                <Text style={styles.title}>Settings</Text>
                <View style={{ width: 26 }} />
            </View>

            <View style={styles.content}>
                <Pressable style={styles.locationButton} onPress={() => Linking.openSettings()}>
                    <Ionicons name="location-outline" size={20} color="#111" />
                    <Text style={styles.locationText}>Location Services</Text>
                    <Text style={styles.locationStatus}>{LOCATION_STATUS_LABEL[location.status]}</Text>
                    <Ionicons name="chevron-forward" size={18} color="#999" />
                </Pressable>
                {IS_DEV_MODE && (
                    <Pressable style={styles.debugButton} onPress={() => router.push('/debug')}>
                        <Ionicons name="bug-outline" size={20} color="#111" />
                        <Text style={styles.debugText}>Debug</Text>
                    </Pressable>
                )}
                <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
                    <Ionicons name="log-out-outline" size={20} color="#c0392b" />
                    <Text style={styles.signOutText}>Sign Out</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
    content: { padding: 20 },
    locationButton: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
    locationText: { flex: 1, fontSize: 16, fontWeight: '600', color: '#111' },
    locationStatus: { fontSize: 15, color: '#999' },
    debugButton: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
    debugText: { fontSize: 16, fontWeight: '600', color: '#111' },
    signOutButton: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
    signOutText: { fontSize: 16, fontWeight: '600', color: '#c0392b' },
});

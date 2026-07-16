// mobile/app/(tabs)/profile/index.tsx
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { supabase } from '../../../lib/supabase';

export default function ProfileScreen() {
    return (
        <View style={styles.container}>
            <Text style={styles.text}>Profile — stub</Text>
            <Pressable style={styles.button} onPress={() => supabase.auth.signOut()}>
                <Text style={styles.buttonText}>Sign Out</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
    text: { color: '#888' },
    button: { paddingVertical: 10, paddingHorizontal: 20, backgroundColor: '#111', borderRadius: 8 },
    buttonText: { color: '#fff', fontWeight: '600' },
});
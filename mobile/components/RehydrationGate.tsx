// mobile/components/RehydrationGate.tsx
// Wraps the authenticated area. Runs once per session where local `trips` is
// empty and remote history exists. Brief loading state while replay runs —
// expected well under a second at this project's real scale.
import { useEffect, useState, ReactNode } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useDb } from '../contexts/DatabaseContext';
import { useUserId } from '../contexts/AuthContext';
import { needsRehydration, rehydrateFromRemote } from '../db/rehydrate';

export function RehydrationGate({ children }: { children: ReactNode }) {
    const db = useDb();
    const userId = useUserId();
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                if (await needsRehydration(db)) {
                    const result = await rehydrateFromRemote(db, userId);
                    console.log('Rehydration complete:', result);
                }
            } catch (err) {
                console.error('Rehydration failed:', err);
                // Fail open — an empty local projection is the same state the
                // user would've seen without rehydration at all; don't block
                // the app on a rehydration bug.
            } finally {
                setChecked(true);
            }
        })();
    }, [db, userId]);

    if (!checked) {
        return (
            <View style={styles.container}>
                <ActivityIndicator />
                <Text style={styles.text}>Restoring your data…</Text>
            </View>
        );
    }

    return <>{children}</>;
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    text: { fontSize: 14, color: '#666' },
});
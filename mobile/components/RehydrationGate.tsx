// mobile/components/RehydrationGate.tsx
// Wraps the authenticated area. Runs once per session where local `trips` is
// empty and remote history exists. Brief loading state while replay runs —
// expected well under a second at this project's real scale.
import { useEffect, useState, ReactNode } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useDb } from '../contexts/DatabaseContext';
import { useUserId } from '../contexts/AuthContext';
import { useTriviaPreferences } from '../contexts/TriviaPreferencesContext';
import { needsRehydration, rehydrateFromRemote, wipeIfDifferentAccount } from '../db/rehydrate';
import { withDbLock } from '../lib/dbLock';

export function RehydrationGate({ children }: { children: ReactNode }) {
    const db = useDb();
    const userId = useUserId();
    const { refresh: refreshTriviaPreferences } = useTriviaPreferences();
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                // withDbLock -- SyncContext's on-mount sync sits above this
                // component in the tree and isn't otherwise aware of it;
                // without this, its own transaction could open concurrently
                // with the wipe/rehydrate transactions below on the same
                // SQLite connection, which expo-sqlite doesn't support (see
                // dbLock.ts).
                await withDbLock(async () => {
                    // Must run first -- if a different account signed in on
                    // this device before this one, this clears their stale
                    // local rows so needsRehydration correctly sees this
                    // user as needing a fresh pull, in this same pass.
                    await wipeIfDifferentAccount(db, userId);
                    if (await needsRehydration(db, userId)) {
                        const result = await rehydrateFromRemote(db, userId);
                        console.log('Rehydration complete:', result);
                    }
                });
            } catch (err) {
                console.error('Rehydration failed:', err);
                // Fail open — an empty local projection is the same state the
                // user would've seen without rehydration at all; don't block
                // the app on a rehydration bug.
            } finally {
                // Resolves a race: this provider's own mount-time preference
                // read isn't gated on rehydration finishing, so on a fresh
                // install it could run before rehydration has restored the
                // user's saved trivia preferences from remote. Cheap no-op
                // read if nothing changed.
                await refreshTriviaPreferences();
                setChecked(true);
            }
        })();
    }, [db, userId, refreshTriviaPreferences]);

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
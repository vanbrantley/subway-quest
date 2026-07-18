// mobile/contexts/SyncContext.tsx
import { createContext, useState, useContext, useEffect, useRef, useCallback, ReactNode } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useDb } from './DatabaseContext';
import { syncPendingEvents } from '../lib/sync';

type SyncContextValue = {
    triggerSync: () => void;
    isSyncing: boolean;
    lastSyncAt: Date | null;
    lastSyncError: string | null;
};
const SyncContext = createContext<SyncContextValue>({
    triggerSync: () => { },
    isSyncing: false,
    lastSyncAt: null,
    lastSyncError: null,
});

export function SyncProvider({ children }: { children: ReactNode }) {
    const db = useDb();
    const runningRef = useRef(false);
    const rerunQueuedRef = useRef(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
    const [lastSyncError, setLastSyncError] = useState<string | null>(null);

    // Coalesces overlapping triggers: if a sync is already in flight when
    // triggerSync fires again (e.g. NetInfo and a local write land at
    // nearly the same moment), don't start a second overlapping run —
    // just queue one more pass right after the current one finishes.
    const runSync = useCallback(async () => {
        if (runningRef.current) {
            rerunQueuedRef.current = true;
            return;
        }
        runningRef.current = true;
        setIsSyncing(true);
        try {
            await syncPendingEvents(db);
            setLastSyncAt(new Date());
            setLastSyncError(null);
        } catch (err) {
            console.error('Sync failed:', err);
            setLastSyncError(err instanceof Error ? err.message : String(err));
        } finally {
            runningRef.current = false;
            setIsSyncing(false);
            if (rerunQueuedRef.current) {
                rerunQueuedRef.current = false;
                runSync();
            }
        }
    }, [db]);

    const triggerSync = useCallback(() => { runSync(); }, [runSync]);

    useEffect(() => {
        runSync(); // covers "app opened while already online"

        const unsubscribeNet = NetInfo.addEventListener((state) => {
            if (state.isConnected) runSync();
        });

        const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
            if (next === 'active') runSync();
        });

        return () => {
            unsubscribeNet();
            appStateSub.remove();
        };
    }, [runSync]);

    return (
        <SyncContext.Provider value={{ triggerSync, isSyncing, lastSyncAt, lastSyncError }}>
            {children}
        </SyncContext.Provider>
    );
}

export function useSyncEngine(): SyncContextValue {
    return useContext(SyncContext);
}
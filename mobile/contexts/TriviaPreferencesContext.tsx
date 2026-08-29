// mobile/contexts/TriviaPreferencesContext.tsx
//
// Holds only the GLOBAL Fun Facts on/off flag -- per-station/per-line
// visibility is deliberately NOT here (StationTriviaFact/LineTriviaFact
// already self-fetch their own scoped data on mount, same convention as
// StationQuestsList; there's no cross-screen reactivity need for one
// station's own toggle). The global flag is different: Station page, Line
// page, and Trip Summary are three independently-mounted screens that must
// all see a Settings change immediately, which is what a Context is for.
//
// Mounted in app/_layout.tsx ABOVE Stack.Protected, nested INSIDE SyncProvider
// (SyncProvider only needs useDb(), nothing auth-related, so it's safe to sit
// above this too) -- station/[stationId].tsx, line/[lineId].tsx, and trip.tsx
// are root-level Stack screens, siblings of (tabs), so a provider mounted
// inside TabsLayout/RehydrationGate would never wrap them. That means this
// provider sits above both the signed-in and signed-out branches, so it's
// built on the nullable useAuth(), never the throwing useUserId() -- but
// still below SyncProvider, so useSyncEngine() below resolves to the real
// context, not its no-op default.

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useDb } from './DatabaseContext';
import { useAuth } from './AuthContext';
import { useSyncEngine } from './SyncContext';
import { getTriviaFactsEnabled } from '../db/trivia';
import { setTriviaFactsEnabled } from '../db/projection';
import { getOrCreateDeviceId } from '../lib/device';

type TriviaPreferencesState = {
    factsEnabled: boolean;
    loading: boolean;
    setFactsEnabled: (enabled: boolean) => Promise<void>;
    refresh: () => Promise<void>; // called by RehydrationGate, to resolve the race between
    // this provider's own mount-time read and rehydration's replay of a
    // fresh install's remote trivia_facts_enabled/disabled history
};

const TriviaPreferencesContext = createContext<TriviaPreferencesState>({
    factsEnabled: true,
    loading: false,
    setFactsEnabled: async () => {},
    refresh: async () => {},
});

export function TriviaPreferencesProvider({ children }: { children: ReactNode }) {
    const db = useDb();
    const { session } = useAuth();
    const { triggerSync } = useSyncEngine();
    const userId = session?.user.id ?? null;
    const [factsEnabled, setFactsEnabledState] = useState(true);
    const [loading, setLoading] = useState(false);

    // Shared by the mount effect below and the exported refresh() (called by
    // RehydrationGate after its own replay finishes, to resolve the race
    // between this provider's own initial read and rehydration restoring a
    // fresh install's remote trivia_facts_enabled/disabled history).
    const load = useCallback(async (): Promise<boolean | null> => {
        if (!userId) {
            setLoading(false);
            return null;
        }
        setLoading(true);
        const enabled = await getTriviaFactsEnabled(db, userId);
        setLoading(false);
        return enabled;
    }, [db, userId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const enabled = await load();
            if (!cancelled && enabled !== null) setFactsEnabledState(enabled);
        })();
        return () => {
            cancelled = true;
        };
    }, [load]);

    async function refresh(): Promise<void> {
        const enabled = await load();
        if (enabled !== null) setFactsEnabledState(enabled);
    }

    async function setFactsEnabled(enabled: boolean): Promise<void> {
        if (!userId) return; // Settings is only reachable signed-in; defensive, not a real path
        setFactsEnabledState(enabled); // optimistic
        const deviceId = await getOrCreateDeviceId();
        await setTriviaFactsEnabled(db, enabled, { deviceId, userId });
        triggerSync(); // same as every other write path (e.g. toggleSave) -- without
        // this, the event just sits pending until some unrelated sync happens to
        // fire (this is the exact bug that made the earlier rehydration test
        // fail: the toggle never reached Supabase before the app was deleted).
    }

    return (
        <TriviaPreferencesContext.Provider value={{ factsEnabled, loading, setFactsEnabled, refresh }}>
            {children}
        </TriviaPreferencesContext.Provider>
    );
}

export function useTriviaPreferences(): TriviaPreferencesState {
    return useContext(TriviaPreferencesContext);
}

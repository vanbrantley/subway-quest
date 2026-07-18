// mobile/contexts/AuthContext.tsx
// Plain context. Deliberately no getSession()/onAuthStateChange here — root
// layout is "the one place session state is checked" (its own header
// comment), so this just exposes what it already computes rather than
// adding a second, competing subscription.
import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';

type AuthState = { session: Session | null; loading: boolean };
export const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function useAuth(): AuthState {
    return useContext(AuthContext);
}

/** For screens reached only through the authed tab stack, where
 *  Stack.Protected already guarantees a session exists. Throws otherwise —
 *  that'd be a routing bug, not a state to render around. */
export function useUserId(): string {
    const { session } = useAuth();
    if (!session?.user.id) throw new Error('useUserId() called without an active session');
    return session.user.id;
}
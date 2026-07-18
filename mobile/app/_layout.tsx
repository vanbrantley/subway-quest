// mobile/app/_layout.tsx
//
// Root layout — the one place session state is checked and used to decide which
// route group the user even has access to. Every other screen just assumes it's
// running in the right context; this file is what makes that assumption true.

import { useEffect, useState, useCallback } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AuthContext } from '../contexts/AuthContext';
import { DatabaseProvider } from '../contexts/DatabaseContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {

  console.log('layout mounted');

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  const handleDbReady = useCallback(() => setDbLoaded(true), []);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        if (error) console.error('getSession error:', error);
        setSession(session);
        setSessionLoaded(true);
      })
      .catch((err) => {
        console.error('getSession threw:', err);
        setSessionLoaded(true); // fail open to the sign-in screen rather than hang forever
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (sessionLoaded && dbLoaded) {
      SplashScreen.hideAsync();
    }
  }, [sessionLoaded, dbLoaded]);

  if (!sessionLoaded) {
    return null; // splash screen stays up until the first session check resolves —
    // no flash of the sign-in screen for someone who's already signed in
  }

  return (
    <AuthContext.Provider value={{ session, loading: false }}>
      <DatabaseProvider onReady={handleDbReady}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={!!session}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="log-trip" options={{ presentation: 'modal' }} />
          </Stack.Protected>

          <Stack.Protected guard={!session}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      </DatabaseProvider>
    </AuthContext.Provider>
  );
}
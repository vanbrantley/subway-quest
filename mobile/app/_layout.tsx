// mobile/app/_layout.tsx
//
// Root layout — the one place session state is checked and used to decide which
// route group the user even has access to. Every other screen just assumes it's
// running in the right context; this file is what makes that assumption true.

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    // Check whatever session SecureStore already has on launch — this is what makes
    // "kill and reopen the app, still signed in" actually true, per ui-spec.md's
    // "minimizing re-auth friction."
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionLoaded(true);
    });

    // Keeps session state current for the lifetime of the app — sign-in, sign-out,
    // and silent token refreshes (handled by the AppState listener in lib/supabase.ts)
    // all flow through here.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (sessionLoaded) {
      SplashScreen.hideAsync();
    }
  }, [sessionLoaded]);

  if (!sessionLoaded) {
    return null; // splash screen stays up until the first session check resolves —
    // no flash of the sign-in screen for someone who's already signed in
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>

      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
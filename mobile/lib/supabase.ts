// mobile/lib/supabase.ts
//
// Single shared Supabase client. Everything else in the app — auth, the sync worker's
// writes to raw_events/operational — imports `supabase` from here rather than creating
// its own client.

import 'react-native-url-polyfill/auto'; // React Native's JS environment lacks parts of
// the URL API supabase-js depends on — this patches
// it in. Must be imported before createClient.
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

// Supabase persists the session (access + refresh token) through this adapter. Using
// SecureStore rather than plain AsyncStorage — the session is a real credential, not
// app preferences, and SecureStore backs onto the iOS Keychain instead of a plaintext
// file. iOS-only for v1 (per ui-spec.md), so no web/AsyncStorage branch needed here —
// that's a real simplification, not an oversight, and would need revisiting if a web
// or Android build ever gets added later.
const ExpoSecureStoreAdapter = {
    getItem: (key: string) => SecureStore.getItemAsync(key),
    setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL!,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
        auth: {
            storage: ExpoSecureStoreAdapter,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false, // no OAuth redirect flow in this app — native only
        },
    }
);

// supabase-js won't auto-refresh the session while the app is backgrounded (there's no
// timer running). This ties refresh to the app's actual foreground/background state —
// refresh resumes the moment the app becomes active again, pauses when it doesn't need
// to be running at all. Supabase's own recommended pattern for React Native/Expo.
AppState.addEventListener('change', (state) => {
    if (state === 'active') {
        supabase.auth.startAutoRefresh();
    } else {
        supabase.auth.stopAutoRefresh();
    }
});
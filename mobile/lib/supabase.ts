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

// Supabase persists the session (access + refresh token + user metadata) through this
// adapter. Using SecureStore rather than plain AsyncStorage — the session is a real
// credential, not app preferences, and SecureStore backs onto the iOS Keychain instead
// of a plaintext file. iOS-only for v1 (per ui-spec.md), so no web/AsyncStorage branch
// needed here — a real simplification, not an oversight.
//
// SecureStore has a real per-value size ceiling (~2048 bytes) — a full Supabase session
// routinely exceeds that once it includes both tokens plus user metadata (full_name,
// given_name, family_name). This chunks a value across multiple SecureStore keys under
// that limit and reassembles it on read, rather than hitting the ceiling silently.
const CHUNK_SIZE = 2000; // stay safely under SecureStore's ~2048-byte ceiling

async function getAllChunks(key: string): Promise<string | null> {
    const first = await SecureStore.getItemAsync(`${key}_0`);
    if (first === null) return null;
    let result = first;
    let i = 1;
    while (true) {
        const chunk = await SecureStore.getItemAsync(`${key}_${i}`);
        if (chunk === null) break;
        result += chunk;
        i++;
    }
    return result;
}

async function setAllChunks(key: string, value: string): Promise<void> {
    const chunkCount = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i++) {
        await SecureStore.setItemAsync(`${key}_${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
    // clean up leftover chunks if this value is shorter than what was stored before
    let i = chunkCount;
    while ((await SecureStore.getItemAsync(`${key}_${i}`)) !== null) {
        await SecureStore.deleteItemAsync(`${key}_${i}`);
        i++;
    }
}

async function removeAllChunks(key: string): Promise<void> {
    let i = 0;
    while ((await SecureStore.getItemAsync(`${key}_${i}`)) !== null) {
        await SecureStore.deleteItemAsync(`${key}_${i}`);
        i++;
    }
}

const ExpoSecureStoreAdapter = {
    getItem: getAllChunks,
    setItem: setAllChunks,
    removeItem: removeAllChunks,
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
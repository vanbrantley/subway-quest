// mobile/lib/device.ts
// Client-generated device_id — secondary/diagnostic only, not the security
// boundary (user_id is). Generated once per install, persisted. See
// data-layer.md's Envelope.
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';

const DEVICE_ID_KEY = 'subwayquest_device_id';
let cached: string | null = null;

export async function getOrCreateDeviceId(): Promise<string> {
    if (cached) return cached;
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing) return (cached = existing);
    const id = randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    return (cached = id);
}
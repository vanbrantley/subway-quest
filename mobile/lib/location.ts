// mobile/lib/location.ts
//
// Foreground-only location: no background permission is ever requested, and
// nothing here is written to SQLite or Supabase -- coords live in memory
// only, for as long as the Map tab is focused. Matches the privacy policy's
// "on-device, optional" claim.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

export type PermissionStatus = 'undetermined' | 'granted' | 'denied';

function toStatus(status: Location.PermissionStatus): PermissionStatus {
    if (status === Location.PermissionStatus.GRANTED) return 'granted';
    if (status === Location.PermissionStatus.DENIED) return 'denied';
    return 'undetermined';
}

export async function checkLocationPermission(): Promise<{ status: PermissionStatus; canAskAgain: boolean }> {
    const result = await Location.getForegroundPermissionsAsync();
    return { status: toStatus(result.status), canAskAgain: result.canAskAgain };
}

// Shared by the Map tab and the Settings row -- both need to know the
// current permission state and both need it to refresh itself when the user
// backgrounds the app to visit Settings and comes back.
export function usePermissionStatus() {
    const [status, setStatus] = useState<PermissionStatus>('undetermined');
    const [canAskAgain, setCanAskAgain] = useState(true);

    const refresh = useCallback(async () => {
        const result = await checkLocationPermission();
        setStatus(result.status);
        setCanAskAgain(result.canAskAgain);
        return result;
    }, []);

    // Only ever called from the map's first-ever-visit flow (status still
    // 'undetermined') -- once iOS resolves it to granted/denied there's no
    // "ask me later," so that check is self-limiting to once per install.
    // Every later "change your mind" path goes through Settings instead.
    const requestPermission = useCallback(async () => {
        const result = await Location.requestForegroundPermissionsAsync();
        const next = toStatus(result.status);
        setStatus(next);
        setCanAskAgain(result.canAskAgain);
        return next;
    }, []);

    useEffect(() => {
        refresh();
        const sub = AppState.addEventListener('change', (state) => {
            if (state === 'active') refresh();
        });
        return () => sub.remove();
    }, [refresh]);

    return { status, canAskAgain, refresh, requestPermission };
}

type Coords = { latitude: number; longitude: number };

// Builds on usePermissionStatus for the Map tab specifically -- adds the
// live position watch, started only after permission is confirmed granted
// (by the caller).
export function useUserLocation() {
    const permission = usePermissionStatus();
    const [coords, setCoords] = useState<Coords | null>(null);
    const posSub = useRef<Location.LocationSubscription | null>(null);

    const startWatching = useCallback(async () => {
        if (posSub.current) return;
        posSub.current = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, timeInterval: 3000, distanceInterval: 5 },
            (loc) => setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
        );
    }, []);

    const stopWatching = useCallback(() => {
        posSub.current?.remove();
        posSub.current = null;
        setCoords(null);
    }, []);

    useEffect(() => stopWatching, [stopWatching]);

    return { ...permission, coords, startWatching, stopWatching };
}

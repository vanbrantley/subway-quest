// mobile/lib/mapHighlight.ts
//
// Station Detail's "View on Map" button needs to tell the Map tab which station to
// jump to and highlight after navigating there. Map stays mounted across tab
// switches (see tabBarScrollReset.ts), so this stashes the target in a module-level
// variable and lets Map's own useFocusEffect pick it up and clear it when it next
// gains focus -- same "registry, not a ref" shape as tabBarScrollReset.ts, but
// carrying a payload since Map needs to know *which* station, not just that a
// reset happened.
export type MapHighlightTarget = { stationId: string; lat: number; lon: number };

let pendingTarget: MapHighlightTarget | null = null;

export function setPendingMapHighlight(target: MapHighlightTarget) {
    pendingTarget = target;
}

export function consumePendingMapHighlight(): MapHighlightTarget | null {
    const target = pendingTarget;
    pendingTarget = null;
    return target;
}

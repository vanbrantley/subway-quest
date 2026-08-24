// mobile/lib/tabBarScrollReset.ts
//
// Map and Profile stay mounted across tab switches (standard tab-navigator behavior -- same
// reason lib/tabBarReset.ts exists), so their scroll position / map region persists when you
// leave and come back. That's the desired default, but tapping the tab you're ALREADY on is the
// usual convention for an explicit "reset to top" -- this registry lets CustomTabBar trigger that
// without owning a ref into either screen directly.
type ResetFn = () => void;

let mapReset: ResetFn | null = null;
let profileScrollReset: ResetFn | null = null;

export function registerMapReset(fn: ResetFn | null) {
    mapReset = fn;
}

export function registerProfileScrollReset(fn: ResetFn | null) {
    profileScrollReset = fn;
}

export function resetMapView() {
    mapReset?.();
}

export function resetProfileScroll() {
    profileScrollReset?.();
}

// mobile/lib/tabBarReset.ts
//
// Profile is the only tab with its own nested Stack (app/(tabs)/profile/_layout.tsx), so it's
// the only one that can have pushed screens (settings, achievements list) sitting on top of its
// root when a tab is tapped. router.dismissAll() (used by CustomTabBar) only clears the ROOT
// stack that (tabs)/station/line/trip/achievements live on — it can't reach into a nested
// navigator. This registry lets the Profile stack hand up its own navigation object so the tab
// bar can pop it back to its root too.
//
// Registered from app/(tabs)/profile/index.tsx specifically (not profile/_layout.tsx) --
// useNavigation() called inside a layout file resolves to the PARENT navigator (Tabs' "profile"
// screen), since the layout hasn't rendered its own <Stack> yet at that point. A screen actually
// inside the nested stack sees the nested stack's own navigation object.
import { StackActions } from '@react-navigation/native';
import { router, type useRootNavigationState } from 'expo-router';

// Only `dispatch`/`getState` are needed here, so this stays structurally compatible with
// whatever specific NavigationProp<...> type expo-router's useNavigation() infers per call
// site, rather than fighting its generics.
type Dispatcher = {
    dispatch: (action: ReturnType<typeof StackActions.popToTop>) => void;
    getState: () => { index?: number; routes: unknown[] } | undefined;
};

let profileNavigation: Dispatcher | null = null;

export function registerProfileNavigation(nav: Dispatcher | null) {
    profileNavigation = nav;
}

export function resetProfileStack() {
    // StackActions.popToTop() dispatched while already at the stack's single root route
    // resolves to `null` in React Navigation's StackRouter -- i.e. genuinely *unhandled*, not
    // a no-op -- and bubbles up through the Tabs navigator to the root Stack, which is also
    // unhandled, producing an "action not handled by any navigator" warning. Guard against
    // dispatching it at all unless there's actually a pushed screen (settings, achievements
    // list) sitting on top of Profile's root to pop back from.
    const state = profileNavigation?.getState();
    if (state && (state.index ?? 0) > 0) {
        profileNavigation!.dispatch(StackActions.popToTop());
    }
}

type TabKey = 'map' | 'search' | 'profile';

// Shared by CustomTabBar's own tab-press handler and any other screen that needs to jump
// straight to a tab (e.g. Station Detail's "View on Map" button). Pulled out here rather than
// duplicated at each call site since the dismissAll() guard below is a documented React
// Navigation footgun, not an obvious rule -- see the popToTop() comment above for the analogous
// "unhandled, not a no-op" issue. dismissAll() dispatches an untargeted POP_TO_TOP, which only
// ever resolves against the ROOT stack's own router -- and that router treats popping a stack
// that's already at its single route as genuinely unhandled, logging "action not handled by any
// navigator". router.canDismiss() isn't the right guard: it walks the whole focused chain
// looking for ANY dismissable stack, so it comes back true off Profile's own nested stack (e.g.
// sitting on Settings) even when the root stack itself has nothing to pop. Check the root
// stack's own route count directly instead.
export function navigateToTab(tab: TabKey, rootState: ReturnType<typeof useRootNavigationState>) {
    resetProfileStack();
    if ((rootState?.routes.length ?? 0) > 1) router.dismissAll();
    router.navigate(`/${tab}`);
}

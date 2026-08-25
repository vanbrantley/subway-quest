// mobile/components/CustomTabBar.tsx
//
// Permanent tab bar, mounted once at the root layout (same "always-visible overlay sibling"
// pattern as DevModeBadge/LogTripFAB) rather than inside (tabs)/_layout.tsx -- so it stays on
// screen for root-level detail pages (station/line/trip/achievements) too, which the native
// <Tabs> bar never covered since those routes aren't nested inside the tabs navigator (see
// docs/status.md "Milestone 8" for why they're root-level siblings instead).
//
// Tapping a tab always lands on that tab's root and drops any pushed screens: resetProfileStack()
// clears Profile's own nested stack (the one tab with pushable children), router.dismissAll()
// clears the root stack (pops station/line/trip/achievements pushes back to (tabs)), then
// router.navigate() selects the target tab. Tapping the tab you're already sitting on skips all
// of that and instead resets that screen's own view (see lib/tabBarScrollReset.ts).
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router, usePathname, useRootNavigationState } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { resetProfileStack } from '../lib/tabBarReset';
import { resetMapView, resetProfileScroll } from '../lib/tabBarScrollReset';

type TabKey = 'map' | 'search' | 'profile';

const TABS: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'map', label: 'Map', icon: 'map-outline' },
    { key: 'search', label: 'Search', icon: 'search-outline' },
    { key: 'profile', label: 'Profile', icon: 'person-outline' },
];

// Content height only -- the safe-area bottom inset is added on top of this at render time.
export const TAB_BAR_HEIGHT = 56;

export function CustomTabBar() {
    const { session } = useAuth();
    const insets = useSafeAreaInsets();
    const pathname = usePathname();
    const rootState = useRootNavigationState();
    const [activeTab, setActiveTab] = useState<TabKey>('map');

    useEffect(() => {
        if (pathname.startsWith('/map')) setActiveTab('map');
        else if (pathname.startsWith('/search')) setActiveTab('search');
        else if (pathname.startsWith('/profile')) setActiveTab('profile');
        // Any other route (station/line/trip/achievements/log-trip/debug) leaves the
        // previously-active tab highlighted -- there's no tab of its own to switch to.
    }, [pathname]);

    if (!session || pathname === '/log-trip') return null;

    const handlePress = (tab: TabKey) => {
        // Already sitting on that tab's own root screen -- Map/Search/Profile all stay mounted
        // across switches (so scroll/map position persists, which is normal tab-navigator
        // behavior), but tapping the active tab again is the usual convention for an explicit
        // reset. Map re-centers, Profile scrolls to top; nothing to navigate, so stop here.
        if (pathname === `/${tab}`) {
            if (tab === 'map') resetMapView();
            if (tab === 'profile') resetProfileScroll();
            return;
        }

        resetProfileStack();
        // dismissAll() dispatches an untargeted POP_TO_TOP, which only ever resolves against the
        // ROOT stack's own router (it never bubbles down into children) -- and that router treats
        // popping a stack that's already at its single route as genuinely *unhandled*, not a
        // no-op, logging "action not handled by any navigator". router.canDismiss() isn't the
        // right guard here: it walks the whole focused chain looking for ANY dismissable stack,
        // so it comes back true off Profile's own nested stack (e.g. sitting on Settings) even
        // when the root stack itself has nothing to pop. Check the root stack's own route count
        // directly instead.
        if ((rootState?.routes.length ?? 0) > 1) router.dismissAll();
        router.navigate(`/${tab}`);
    };

    return (
        <View style={[styles.bar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}>
            {TABS.map((tab) => {
                const focused = tab.key === activeTab;
                const color = focused ? '#111' : '#8e8e93';
                return (
                    <Pressable key={tab.key} style={styles.tab} onPress={() => handlePress(tab.key)} accessibilityLabel={tab.label}>
                        <Ionicons name={tab.icon} size={24} color={color} />
                        <Text style={[styles.label, { color }]}>{tab.label}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#ddd',
    },
    tab: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 8,
        gap: 2,
    },
    label: {
        fontSize: 11,
        fontWeight: '600',
    },
});

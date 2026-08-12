// mobile/components/ui/RouteIcon.tsx
// Shared route-icon renderer (custom SVG, falling back to a colored bubble
// with the route letter/number) -- extracted from station/[stationId].tsx's
// former local copy so it can also be used by TripHistoryRow, which is
// mounted on both the Station and Profile pages.
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { LINE_ICONS } from '../../constants/lineIcons';
import { LINE_COLORS } from '../../constants/lineColors';
import { normalizeRouteIdForIcon } from '../../lib/subwayData';

export function RouteIcon({ routeId, onPress, size = 40 }: { routeId: string; onPress: (() => void) | null; size?: number }) {
    const iconId = normalizeRouteIdForIcon(routeId);
    const Icon = LINE_ICONS[iconId];
    const content = Icon ? (
        <Icon width={size} height={size} />
    ) : (
        <View style={[styles.colorBubble, { width: size, height: size, borderRadius: size / 2, backgroundColor: LINE_COLORS[iconId]?.bg ?? '#ccc' }]}>
            <Text style={[styles.colorBubbleText, { color: LINE_COLORS[iconId]?.text ?? '#000', fontSize: size * 0.35 }]}>{routeId}</Text>
        </View>
    );
    if (!onPress) return <View style={[styles.wrap, { width: size, height: size }]}>{content}</View>;
    return <Pressable style={[styles.wrap, { width: size, height: size }]} onPress={onPress}>{content}</Pressable>;
}

const styles = StyleSheet.create({
    wrap: { justifyContent: 'center', alignItems: 'center' },
    colorBubble: { justifyContent: 'center', alignItems: 'center' },
    colorBubbleText: { fontWeight: '700' },
});

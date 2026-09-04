// mobile/components/ui/StationRow.tsx
// Shared station-list row (visited checkmark, name, every transfer icon,
// chevron) -- extracted from line/[lineId].tsx's former local copy. Line
// pages only: the trailing icons are a narrower "other lines reachable via
// transfer at this stop's complex" hint, not the station's full set of
// lines -- see StationLinesRow for that (Profile's saved stations, Borough/
// Neighborhood pages), a deliberately distinct component so the same-looking
// row shape never means two different things in two places.
import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getOtherComplexRoutes, getStationName } from '../../lib/subwayData';
import { RouteIcon } from './RouteIcon';

export function StationRow({ stopId, visited, onPress }: { stopId: string; visited: boolean; onPress: () => void }) {
    // Every other line reachable via transfer at this stop's complex --
    // deliberately uncapped (a real MTA station board never hides a
    // transfer to save space, so neither should this) and right-aligned,
    // free to push into the name's space; the name truncates with an
    // ellipsis rather than the transfer list ever being incomplete. The
    // full name is always one tap away on the station's own page.
    const transferRoutes = useMemo(() => getOtherComplexRoutes(stopId), [stopId]);

    return (
        <Pressable style={styles.row} onPress={onPress}>
            <Ionicons
                name={visited ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={visited ? '#3d9a5c' : '#ccc'}
            />
            <Text style={styles.rowText} numberOfLines={1}>{getStationName(stopId)}</Text>
            {transferRoutes.length > 0 && (
                <View style={styles.transferIcons}>
                    {transferRoutes.map((r) => <RouteIcon key={r} routeId={r} size={16} onPress={null} />)}
                </View>
            )}
            <Ionicons name="chevron-forward" size={16} color="#ccc" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    rowText: { flex: 1, fontSize: 15, color: '#222' },
    transferIcons: { flexDirection: 'row', gap: 4, flexShrink: 0 },
});

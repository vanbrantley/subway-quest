// mobile/components/ui/StationLinesRow.tsx
// Station row showing every line the station serves, icon-before-name --
// extracted from Profile's former inline "Saved stations" row so Borough/
// Neighborhood pages can show the same thing the same way. Deliberately a
// separate component from StationRow (Line pages only): StationRow's
// trailing, capped-at-2 icons mean something narrower ("other lines you can
// transfer to here, given you're already on this one"), which would be
// genuinely confusing to render identically to "every line this station
// serves" -- same shape, different meaning. Icon-before-name here matches
// the convention trip legs already use for "this icon is the line," so it
// reads as one consistent rule across the app: leading icon = lines served,
// trailing icon = a Line page's own transfer hint.
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getStationName } from '../../lib/subwayData';
import { RouteIcon } from './RouteIcon';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export function StationLinesRow({
    stopId, routeIds, visited, onPress,
    unvisitedIconName = 'ellipse-outline',
    unvisitedIconColor = '#ccc',
}: {
    stopId: string;
    routeIds: string[];
    visited: boolean;
    onPress: () => void;
    // Profile's saved-stations list shows an unvisited-but-saved station as
    // a bookmark rather than a plain empty circle -- everything else (Line
    // pages don't use this component; Borough/Neighborhood have no "saved"
    // concept) just takes the default.
    unvisitedIconName?: IoniconName;
    unvisitedIconColor?: string;
}) {
    return (
        <Pressable style={styles.row} onPress={onPress}>
            <Ionicons
                name={visited ? 'checkmark-circle' : unvisitedIconName}
                size={18}
                color={visited ? '#3d9a5c' : unvisitedIconColor}
            />
            <View style={styles.icons}>
                {routeIds.map((r) => <RouteIcon key={r} routeId={r} onPress={null} size={20} />)}
            </View>
            <Text style={styles.rowText} numberOfLines={1}>{getStationName(stopId)}</Text>
            <Ionicons name="chevron-forward" size={16} color="#ccc" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
    icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flexShrink: 0 },
    rowText: { flex: 1, fontSize: 15, color: '#222' },
});

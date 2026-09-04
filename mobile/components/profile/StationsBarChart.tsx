// mobile/components/profile/StationsBarChart.tsx
// Hand-built horizontal bar chart (react-native-svg, no charting library) --
// top-stations chart for FavoritesCharts. Two rows per entry, matching
// LinesBarChart: row 1 is just the bar + count, flush left; row 2 holds the
// station's route icon(s) (1-3, unlike a line's always-exactly-one) + name.
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RouteIcon } from '../ui/RouteIcon';
import { BarAndCount } from './BarAndCount';

const STATION_ICON_SIZE = 18;
const MAX_STATION_ICONS = 3;

export type StationDatum = {
    key: string;
    name: string;
    value: number;
    color: string;
    routes: string[]; // full list -- this component slices to MAX_STATION_ICONS itself
    onPress: () => void; // non-optional -- a station is always navigable
};

type Props = { data: StationDatum[] };

export function StationsBarChart({ data }: Props) {
    const max = Math.max(1, ...data.map((d) => d.value));

    return (
        <View style={styles.chart}>
            {data.map((d) => {
                const pct = (d.value / max) * 100;
                const icons = d.routes.slice(0, MAX_STATION_ICONS);
                return (
                    <Pressable key={d.key} onPress={d.onPress} style={styles.entry}>
                        <View style={styles.barRow}>
                            <BarAndCount pct={pct} color={d.color} count={d.value} />
                        </View>
                        <View style={styles.nameRow}>
                            {icons.length > 0 && (
                                <View style={styles.iconGroup}>
                                    {icons.map((r) => (
                                        <RouteIcon key={r} routeId={r} onPress={null} size={STATION_ICON_SIZE} />
                                    ))}
                                </View>
                            )}
                            <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    chart: { gap: 10 },
    entry: { gap: 4 },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconGroup: { flexDirection: 'row', gap: 2, flexShrink: 0 },
    name: { flex: 1, fontSize: 13, color: '#333', minWidth: 0 },
});

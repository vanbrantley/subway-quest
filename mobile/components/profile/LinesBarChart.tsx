// mobile/components/profile/LinesBarChart.tsx
// Hand-built horizontal bar chart (react-native-svg, no charting library) --
// top-lines chart for FavoritesCharts. Two rows per entry, mirroring
// StationsBarChart: row 1 is just the bar + count (flush left, no icon
// eating into its width), row 2 is the route icon alone. No text label: the
// icon already bakes in the letter/number (MTA-bullet-style), so a separate
// label would be redundant.
import { View, StyleSheet, Pressable } from 'react-native';
import { RouteIcon } from '../ui/RouteIcon';
import { BarAndCount } from './BarAndCount';

const LINE_ICON_SIZE = 22;

export type LineDatum = {
    key: string;
    routeId: string;
    value: number;
    color: string;
    onPress?: () => void; // optional -- not every route is navigable (see isNavigableRoute)
};

type Props = { data: LineDatum[] };

export function LinesBarChart({ data }: Props) {
    const max = Math.max(1, ...data.map((d) => d.value));

    return (
        <View style={styles.chart}>
            {data.map((d) => {
                const pct = (d.value / max) * 100;
                const entry = (
                    <View style={styles.entry}>
                        <View style={styles.barRow}>
                            <BarAndCount pct={pct} color={d.color} count={d.value} />
                        </View>
                        <RouteIcon routeId={d.routeId} onPress={null} size={LINE_ICON_SIZE} />
                    </View>
                );
                return d.onPress ? (
                    <Pressable key={d.key} onPress={d.onPress}>{entry}</Pressable>
                ) : (
                    <View key={d.key}>{entry}</View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    chart: { gap: 10 },
    entry: { gap: 4 },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

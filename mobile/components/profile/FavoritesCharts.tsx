// mobile/components/profile/FavoritesCharts.tsx
// Top-5 favorite stations/lines as horizontal bar charts, filterable by time
// range -- replaces the old single favorite-station/favorite-line rows.
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { getStation, isNavigableRoute, normalizeRouteIdForIcon } from '../../lib/subwayData';
import { LINE_COLORS } from '../../constants/lineColors';
import type { TimeRange } from '../../lib/dateMath';
import type { FavoriteStation, RouteRideCount } from '../../db/stations_logic';
import { RouteIcon } from '../ui/RouteIcon';
import { TimeRangeFilter } from '../ui/TimeRangeFilter';
import { HorizontalBarChart, type BarDatum } from './HorizontalBarChart';

const STATION_ICON_SIZE = 18;
const LINE_ICON_SIZE = 22;
const MAX_STATION_ICONS = 3;

function rangeLabel(range: TimeRange): string {
    return range === '30d' ? 'the last 30 days' : range === '7d' ? 'the last week' : '';
}

function EmptyRow({ range }: { range: TimeRange }) {
    return (
        <Text style={styles.emptyText}>
            {range === 'all' ? '—' : `No rides in ${rangeLabel(range)}.`}
        </Text>
    );
}

type Props = {
    favorites: { stations: FavoriteStation[]; lines: RouteRideCount[] } | null;
    range: TimeRange;
    onRangeChange: (range: TimeRange) => void;
};

export function FavoritesCharts({ favorites, range, onRangeChange }: Props) {
    const stationData: BarDatum[] = (favorites?.stations ?? []).map((s) => {
        const routes = getStation(s.stationId)?.daytime_routes ?? [];
        const primary = routes[0] ? normalizeRouteIdForIcon(routes[0]) : null;
        return {
            key: s.stationId,
            label: s.name,
            value: s.rideCount,
            color: primary ? (LINE_COLORS[primary]?.bg ?? '#ccc') : '#ccc',
            icon: routes.length > 0 ? (
                <>
                    {routes.slice(0, MAX_STATION_ICONS).map((r) => (
                        <RouteIcon key={r} routeId={r} onPress={null} size={STATION_ICON_SIZE} />
                    ))}
                </>
            ) : undefined,
            onPress: () => router.push(`/station/${s.stationId}`),
        };
    });

    const lineData: BarDatum[] = (favorites?.lines ?? []).map((l) => {
        const target = normalizeRouteIdForIcon(l.routeId);
        const navigable = isNavigableRoute(target);
        return {
            key: l.routeId,
            label: l.routeId,
            value: l.rideCount,
            color: LINE_COLORS[target]?.bg ?? '#ccc',
            icon: <RouteIcon routeId={l.routeId} onPress={null} size={LINE_ICON_SIZE} />,
            onPress: navigable ? () => router.push(`/line/${target}`) : undefined,
        };
    });

    return (
        <View>
            <TimeRangeFilter value={range} onChange={onRangeChange} />

            <Text style={styles.subheader}>Top stations</Text>
            {favorites === null ? (
                <ActivityIndicator />
            ) : stationData.length > 0 ? (
                <HorizontalBarChart data={stationData} />
            ) : (
                <EmptyRow range={range} />
            )}

            <Text style={[styles.subheader, styles.subheaderSpaced]}>Top lines</Text>
            {favorites === null ? (
                <ActivityIndicator />
            ) : lineData.length > 0 ? (
                <HorizontalBarChart data={lineData} />
            ) : (
                <EmptyRow range={range} />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    subheader: { fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 },
    subheaderSpaced: { marginTop: 16 },
    emptyText: { fontSize: 14, color: '#999', fontStyle: 'italic' },
});

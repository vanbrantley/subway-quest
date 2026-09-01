// mobile/components/profile/HorizontalBarChart.tsx
// Hand-built horizontal bar chart (react-native-svg, no charting library) --
// shared by FavoritesCharts for both the top-stations and top-lines charts.
import type { ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

export type BarDatum = {
    key: string;
    label: string;
    value: number;
    color: string;
    icon?: ReactNode;
    onPress?: () => void;
};

const BAR_WIDTH = 100;
const BAR_HEIGHT = 14;

type Props = { data: BarDatum[] };

export function HorizontalBarChart({ data }: Props) {
    const max = Math.max(1, ...data.map((d) => d.value));

    return (
        <View style={styles.chart}>
            {data.map((d) => {
                const pct = (d.value / max) * 100;
                const row = (
                    <View style={styles.row}>
                        {d.icon && <View style={styles.icon}>{d.icon}</View>}
                        <Text style={styles.label} numberOfLines={1}>{d.label}</Text>
                        <Svg width={BAR_WIDTH} height={BAR_HEIGHT} style={styles.bar}>
                            <Rect x={0} y={0} width={`${pct}%`} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} fill={d.color} />
                        </Svg>
                        <Text style={styles.count}>{d.value}</Text>
                    </View>
                );
                return d.onPress ? (
                    <Pressable key={d.key} onPress={d.onPress}>{row}</Pressable>
                ) : (
                    <View key={d.key}>{row}</View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    chart: { gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    icon: { flexDirection: 'row', gap: 2, flexShrink: 0 },
    label: { flex: 1, fontSize: 13, color: '#333', minWidth: 0 },
    bar: { flexShrink: 0 },
    count: { fontSize: 12, fontWeight: '700', color: '#666', width: 24, textAlign: 'right' },
});

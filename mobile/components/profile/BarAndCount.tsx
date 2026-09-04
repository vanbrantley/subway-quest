// mobile/components/profile/BarAndCount.tsx
// Shared low-level piece rendered identically by LinesBarChart and
// StationsBarChart -- the flexible bar + trailing count text. Extracted so
// the two charts can't drift apart on bar height/shape or count styling.
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

export const BAR_HEIGHT = 14;

type Props = { pct: number; color: string; count: number };

export function BarAndCount({ pct, color, count }: Props) {
    // Svg's own width="100%" doesn't reliably resolve against its flex-
    // computed box (confirmed on-device: bars rendered wider than the
    // screen, pushing the count off it) -- measuring the wrapping View's
    // real pixel width via onLayout and passing that as a literal number
    // instead sidesteps the percentage-of-flex resolution entirely. 0 before
    // the first layout pass just skips drawing the bar for one frame.
    const [barWidth, setBarWidth] = useState(0);

    return (
        <>
            <View style={styles.barWrap} onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}>
                {barWidth > 0 && (
                    <Svg width={barWidth} height={BAR_HEIGHT}>
                        <Rect x={0} y={0} width={`${pct}%`} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} fill={color} />
                    </Svg>
                )}
            </View>
            <Text style={styles.count}>{count}</Text>
        </>
    );
}

const styles = StyleSheet.create({
    barWrap: { flex: 1, height: BAR_HEIGHT },
    count: { fontSize: 12, fontWeight: '700', color: '#666', width: 24, textAlign: 'right' },
});

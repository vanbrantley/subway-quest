// mobile/components/trip-logging/TripChipStrip.tsx
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import stations from '../../data/stations.json';
import { LINE_ICONS } from '../../constants/lineIcons';
import { LINE_COLORS } from '../../constants/lineColors';
import type { DraftLeg } from './types';

type Props = {
    legs: DraftLeg[];
    onTapChip: (legIndex: number, field: 'line' | 'entry' | 'exit') => void;
};

const STATIONS = stations as Record<string, { name: string }>;

function stationName(stopId: string | null): string {
    if (!stopId) return '';
    return STATIONS[stopId]?.name ?? stopId;
}

function StationChip({
    stopId,
    locked,
    onPress,
}: {
    stopId: string;
    locked: boolean;
    onPress: () => void;
}) {
    const content = (
        <Text style={styles.stationChipText} numberOfLines={1} ellipsizeMode="tail">
            {stationName(stopId)}
        </Text>
    );

    if (locked) {
        return <View style={[styles.stationChip, styles.stationChipLocked]}>{content}</View>;
    }
    return (
        <Pressable onPress={onPress} style={styles.stationChip}>
            {content}
        </Pressable>
    );
}

export function TripChipStrip({ legs, onTapChip }: Props) {
    if (legs.length === 0) return null;

    return (
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.list}>
            {legs.map((leg, legIndex) => {
                const Icon = LINE_ICONS[leg.routeId];
                const isTransferLeg = legIndex > 0;
                const isLastLeg = legIndex === legs.length - 1;

                return (
                    <View key={legIndex} style={styles.legRow}>
                        <Pressable onPress={() => onTapChip(legIndex, 'line')} style={styles.lineChip}>
                            {Icon ? (
                                <Icon width={26} height={26} />
                            ) : (
                                <View style={[styles.colorDot, { backgroundColor: LINE_COLORS[leg.routeId]?.bg ?? '#ccc' }]}>
                                    <Text style={styles.colorDotText}>{leg.routeId}</Text>
                                </View>
                            )}
                        </Pressable>

                        {leg.entryStationId && (
                            <StationChip
                                stopId={leg.entryStationId}
                                locked={isTransferLeg}
                                onPress={() => onTapChip(legIndex, 'entry')}
                            />
                        )}

                        {leg.exitStationId && (
                            <>
                                <Ionicons name="arrow-forward" size={12} color="#999" style={styles.fixedIcon} />
                                <StationChip
                                    stopId={leg.exitStationId}
                                    locked={false}
                                    onPress={() => onTapChip(legIndex, 'exit')}
                                />
                            </>
                        )}

                        {!isLastLeg && (
                            <Ionicons name="swap-horizontal" size={16} color="#999" style={styles.transferIcon} />
                        )}
                    </View>
                );
            })}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    scrollView: { maxHeight: 140 },
    list: { paddingHorizontal: 16, paddingVertical: 8, gap: 10 },
    legRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'nowrap' },
    fixedIcon: { flexShrink: 0 },
    transferIcon: { marginLeft: 6, flexShrink: 0 },
    lineChip: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
    colorDot: { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
    colorDotText: { fontSize: 11, fontWeight: '700' },
    stationChip: {
        paddingVertical: 5,
        paddingHorizontal: 10,
        backgroundColor: '#e8e8e8',
        borderRadius: 14,
        flexShrink: 1,
        minWidth: 0,
    },
    stationChipLocked: { opacity: 0.6 },
    stationChipText: { fontSize: 13, color: '#444', fontWeight: '500' },
});
// mobile/components/line/StopRideHistory.tsx
// Expandable list of boarded/alighted ride events at one stop on the Line
// page -- "visited" grain (entry or exit), same as the rest of the app; see
// db/trips_logic.ts's groupLegsByStopPure.
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { StopRideEvent } from '../../db/trips_logic';

type Props = { events: StopRideEvent[] };

export function StopRideHistory({ events }: Props) {
    return (
        <View style={styles.wrap}>
            {events.map((e) => (
                <Pressable
                    key={`${e.legId}-${e.kind}`}
                    style={styles.row}
                    onPress={() => router.push({ pathname: '/trip', params: { tripId: e.tripId } })}
                >
                    <Ionicons
                        name={e.kind === 'boarded' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
                        size={16}
                        color="#888"
                    />
                    <Text style={styles.text}>
                        {e.kind === 'boarded' ? 'Boarded' : 'Alighted'} · {new Date(e.at).toLocaleDateString()}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { paddingLeft: 30, paddingBottom: 6, gap: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
    text: { fontSize: 12, color: '#666' },
});

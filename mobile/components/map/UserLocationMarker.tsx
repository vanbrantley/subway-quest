// mobile/components/map/UserLocationMarker.tsx
//
// The "blue dot" -- current position, no heading cone (see lib/location.ts
// and map.tsx's history: a flat+rotation cone here rotates with the map's
// own bearing, not the phone's actual facing, so it read as broken rather
// than helpful).
//
// Built from the same plain-View shape as the station markers in map.tsx
// (white border + colored fill circle, sized off markerSizeForDelta) rather
// than a fixed-size SVG, so it's the identical shape at every zoom level,
// just blue instead of gray/green. `tracksViewChanges` is driven by the
// same `forceTrack` pulse the station markers use -- size changes need a
// native re-snapshot the same way theirs do, and reusing that existing
// pulse keeps this marker in sync with the same zoom-crossing/refetch
// events instead of needing its own separate mechanism.
import { View, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';

type Props = {
    coords: { latitude: number; longitude: number };
    size: number;
    touchSize: number;
    tracksViewChanges: boolean;
    onPress: () => void;
};

export function UserLocationMarker({ coords, size, touchSize, tracksViewChanges, onPress }: Props) {
    return (
        <Marker coordinate={coords} anchor={{ x: 0.5, y: 0.5 }} onPress={onPress} tracksViewChanges={tracksViewChanges}>
            <View style={[styles.touchArea, { width: touchSize, height: touchSize }]}>
                <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2 }]} />
            </View>
        </Marker>
    );
}

const styles = StyleSheet.create({
    touchArea: { justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
    dot: { backgroundColor: '#2f6fed', borderWidth: 1, borderColor: '#fff' },
});

// mobile/components/trip-logging/StationPickerStep.tsx
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { getStationName } from '../../lib/subwayData';

type Props = {
    label: string;
    options: string[]; // stop_ids
    initialValue: string | null;
    onConfirm: (stopId: string) => void;
};

export function StationPickerStep({ label, options, initialValue, onConfirm }: Props) {
    const [value, setValue] = useState(initialValue ?? options[0]);

    return (
        <View style={styles.container}>
            <Text style={styles.label}>{label}</Text>
            <Picker selectedValue={value} onValueChange={setValue} style={styles.picker}>
                {options.map((stopId) => (
                    <Picker.Item key={stopId} label={getStationName(stopId)} value={stopId} />
                ))}
            </Picker>
            <Pressable style={styles.nextButton} onPress={() => onConfirm(value)}>
                <Text style={styles.nextButtonText}>Next</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, alignItems: 'center' },
    label: { fontSize: 15, color: '#444', textAlign: 'center', marginVertical: 16 },
    picker: { width: '100%' },
    nextButton: {
        marginTop: 12,
        paddingVertical: 12,
        paddingHorizontal: 32,
        backgroundColor: '#111',
        borderRadius: 24,
    },
    nextButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
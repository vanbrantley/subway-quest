// mobile/components/map/UserLocationPreviewModal.tsx
//
// Tap-the-dot preview -- same centered-card/dimmed-backdrop chrome as
// StationPreviewModal.tsx, but there's no station-specific data to show
// (lines, saved/visited status), so this is just a label.
import { Modal, Text, StyleSheet, Pressable } from 'react-native';

type Props = {
    visible: boolean;
    onClose: () => void;
};

export function UserLocationPreviewModal({ visible, onClose }: Props) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable style={styles.card} onPress={() => {}}>
                    <Text style={styles.title}>Your Current Location</Text>
                    <Text style={styles.subtitle}>This is roughly where you are right now.</Text>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', gap: 4 },
    title: { fontSize: 19, fontWeight: '700', textAlign: 'center', color: '#111' },
    subtitle: { fontSize: 13, color: '#888', textAlign: 'center' },
});

// mobile/app/(tabs)/_layout.tsx
import { View, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LogTripFAB } from '../../components/LogTripFAB';

export default function TabsLayout() {
    return (
        <View style={styles.container}>
            <Tabs screenOptions={{ headerShown: false }}>
                <Tabs.Screen
                    name="map"
                    options={{
                        title: 'Map',
                        tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={color} />,
                    }}
                />
                <Tabs.Screen
                    name="search"
                    options={{
                        title: 'Search',
                        tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" size={size} color={color} />,
                    }}
                />
                <Tabs.Screen
                    name="profile"
                    options={{
                        title: 'Profile',
                        tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
                    }}
                />
            </Tabs>
            <LogTripFAB />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
});
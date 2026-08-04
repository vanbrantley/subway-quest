// mobile/app/(tabs)/search.tsx
import { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView, FlatList } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LINE_ICONS } from '../../constants/lineIcons';
import { LINE_COLORS } from '../../constants/lineColors';
import {
    getDisplayableRoutes,
    searchStations,
    getBoroughName,
    normalizeRouteIdForIcon,
    type StationSearchResult,
} from '../../lib/subwayData';

const AVAILABLE_ROUTES = getDisplayableRoutes();

function RouteIcon({ routeId, size }: { routeId: string; size: number }) {
    const iconId = normalizeRouteIdForIcon(routeId);
    const Icon = LINE_ICONS[iconId];
    if (Icon) return <Icon width={size} height={size} />;
    return (
        <View style={[styles.colorBubble, { width: size, height: size, borderRadius: size / 2, backgroundColor: LINE_COLORS[iconId]?.bg ?? '#ccc' }]}>
            <Text style={[styles.colorBubbleText, { color: LINE_COLORS[iconId]?.text ?? '#000', fontSize: size * 0.4 }]}>
                {iconId}
            </Text>
        </View>
    );
}

function ResultRow({ result }: { result: StationSearchResult }) {
    return (
        <Pressable style={styles.row} onPress={() => router.push(`/station/${result.stopId}`)}>
            <View style={styles.rowIcons}>
                {result.daytimeRoutes.map((routeId) => (
                    <RouteIcon key={routeId} routeId={routeId} size={26} />
                ))}
            </View>
            <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{result.name}</Text>
                <Text style={styles.rowSubtitle}>{getBoroughName(result.borough)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#ccc" />
        </Pressable>
    );
}

export default function SearchScreen() {
    const insets = useSafeAreaInsets();
    const [query, setQuery] = useState('');

    const results = useMemo(() => searchStations(query), [query]);
    const isSearching = query.trim().length > 0;

    return (
        <View style={styles.container}>
            <View style={[styles.searchBarWrap, { paddingTop: insets.top + 12 }]}>
                <View style={styles.searchBar}>
                    <Ionicons name="search" size={18} color="#999" />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search stations"
                        placeholderTextColor="#999"
                        value={query}
                        onChangeText={setQuery}
                        autoCorrect={false}
                        clearButtonMode="never"
                    />
                    {isSearching && (
                        <Pressable onPress={() => setQuery('')} hitSlop={8}>
                            <Ionicons name="close-circle" size={18} color="#999" />
                        </Pressable>
                    )}
                </View>
            </View>

            {!isSearching ? (
                <ScrollView contentContainerStyle={styles.grid}>
                    {AVAILABLE_ROUTES.map((routeId) => (
                        <Pressable key={routeId} style={styles.bubble} onPress={() => router.push(`/line/${routeId}`)}>
                            <RouteIcon routeId={routeId} size={44} />
                        </Pressable>
                    ))}
                </ScrollView>
            ) : results.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Text style={styles.emptyText}>No stations match &quot;{query.trim()}&quot;</Text>
                </View>
            ) : (
                <FlatList
                    data={results}
                    keyExtractor={(r) => r.stopId}
                    contentContainerStyle={styles.list}
                    renderItem={({ item }) => <ResultRow result={item} />}
                    keyboardShouldPersistTaps="handled"
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    searchBarWrap: { paddingHorizontal: 16, paddingBottom: 12 },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#f0f0f0',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    searchInput: { flex: 1, fontSize: 16, color: '#111' },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 16,
        paddingHorizontal: 20,
        paddingVertical: 20,
    },
    bubble: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
    colorBubble: { justifyContent: 'center', alignItems: 'center' },
    colorBubbleText: { fontWeight: '700' },
    list: { paddingHorizontal: 16, paddingBottom: 24 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
    rowIcons: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, width: '25%' },
    rowText: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: '600', color: '#222' },
    rowSubtitle: { fontSize: 12, color: '#999', marginTop: 1 },
    emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    emptyText: { fontSize: 14, color: '#999', textAlign: 'center' },
});

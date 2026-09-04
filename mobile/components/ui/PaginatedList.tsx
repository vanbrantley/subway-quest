// mobile/components/ui/PaginatedList.tsx
// Shared "count-in-header + Show more/Show less" list -- collapsed to
// `defaultVisible` by default with progressive "Show more" disclosure (not
// infinite scroll -- keeps scroll position predictable and stays simple to
// make accessible) up to "Show all remaining", plus "Show less" to collapse
// back. Used by Profile's Trip History/Saved Stations, Station's Visit
// History, and Line's Visit History, so this behavior only needs to change
// in one place instead of drifting across four near-copies.
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable, type StyleProp, type TextStyle } from 'react-native';
import { SectionHeader } from './SectionHeader';

const DEFAULT_VISIBLE = 5;
const REVEAL_BATCH = 10;

type Props<T> = {
    title: string; // count appended automatically: "Trip history" -> "Trip history (12)"
    items: T[];
    renderItem: (item: T) => ReactNode;
    keyExtractor: (item: T) => string;
    emptyText: string;
    itemNoun: string; // accessibility "show more" label only, e.g. "trips" -- visible text stays noun-free
    headerExtra?: ReactNode; // rendered between the header and the list, e.g. a filter control that applies to this list
    headerStyle?: StyleProp<TextStyle>;
    defaultVisible?: number;
    revealBatch?: number;
    // Opt-in: pagination resets to defaultVisible whenever this value changes
    // (e.g. a time-range filter). Omit entirely for a plain list with no
    // filter concept -- it should never auto-collapse just because `items`
    // refetched with new content (a background sync shouldn't undo a reader's
    // "show more" tap).
    resetKey?: unknown;
};

export function PaginatedList<T>({
    title, items, renderItem, keyExtractor, emptyText, itemNoun, headerExtra,
    headerStyle, defaultVisible = DEFAULT_VISIBLE, revealBatch = REVEAL_BATCH, resetKey,
}: Props<T>) {
    const [visibleCount, setVisibleCount] = useState(defaultVisible);

    // Intentionally keyed on resetKey (and defaultVisible, in case a caller
    // changes it), NOT on `items` -- see the resetKey doc comment above.
    useEffect(() => {
        setVisibleCount(defaultVisible);
    }, [resetKey, defaultVisible]);

    const visible = items.slice(0, visibleCount);
    const remaining = items.length - visibleCount;

    return (
        <View>
            <SectionHeader title={`${title} (${items.length})`} style={headerStyle} />
            {headerExtra}
            {items.length === 0 ? (
                <Text style={styles.emptyText}>{emptyText}</Text>
            ) : (
                <>
                    {visible.map((item) => <Fragment key={keyExtractor(item)}>{renderItem(item)}</Fragment>)}
                    {(remaining > 0 || visibleCount > defaultVisible) && (
                        <View style={styles.footer}>
                            {remaining > 0 && (
                                <Pressable
                                    onPress={() => setVisibleCount((c) => Math.min(items.length, c + revealBatch))}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Show ${Math.min(revealBatch, remaining)} more ${itemNoun}, ${items.length} total`}
                                >
                                    <Text style={styles.footerLink}>
                                        {remaining <= revealBatch ? `Show all remaining (${remaining})` : `Show ${revealBatch} more`}
                                    </Text>
                                </Pressable>
                            )}
                            {visibleCount > defaultVisible && (
                                <Pressable
                                    onPress={() => setVisibleCount(defaultVisible)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Show less ${title.toLowerCase()}`}
                                >
                                    <Text style={styles.footerLink}>Show less</Text>
                                </Pressable>
                            )}
                        </View>
                    )}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    emptyText: { fontSize: 14, color: '#999', fontStyle: 'italic' },
    footer: { flexDirection: 'row', gap: 20, marginTop: 8 },
    footerLink: { fontSize: 13, fontWeight: '700', color: '#444' },
});

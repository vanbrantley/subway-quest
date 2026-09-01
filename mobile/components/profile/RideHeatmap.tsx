// mobile/components/profile/RideHeatmap.tsx
// GitHub-contribution-graph-style calendar heatmap of rides per local day,
// hand-built with react-native-svg. Horizontally scrollable, opens scrolled
// to the most recent weeks. Assumes non-empty dayCounts -- the Profile page
// shows a "No rides logged yet." empty state instead of mounting this when
// there's no ride history at all.
import { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import Svg, { Rect, Text as SvgText, G } from 'react-native-svg';
import { localDateString, daysBetweenLocal, friendlyDateLocal, MONTH_NAMES } from '../../lib/dateMath';
import { buildHeatmapWeeks, type DayCount, type HeatmapCell } from '../../db/ride_activity_logic';

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP; // also the per-cell tap-target size -- see the double-Rect cell render below
const LABEL_HEIGHT = 14;
const MIN_WEEKS_BACK = 12; // ~3 months, even for a very new rider
const MAX_WEEKS_BACK = 104; // ~2 years -- perf/scroll-length ceiling, not a stated requirement
const TOOLTIP_MIN_WIDTH = 90;
const TOOLTIP_CHAR_WIDTH = 6.3; // rough per-character estimate at fontSize 11 -- generously rounded up so real text never wraps, not a font-metrics measurement
const TOOLTIP_H_PADDING = 8; // per side -- matches styles.tooltip's paddingHorizontal
const TOOLTIP_HEIGHT = 22; // single-line height -- always accurate now that the tooltip's width is sized to its own text (see TOOLTIP_CHAR_WIDTH), so it never wraps
const TOOLTIP_GAP = 4; // gap kept between the tooltip and the cell it's pointing at
// Fixed (not dynamic) -- a margin that only appeared on a top-row tap read as
// a layout jump. LABEL_HEIGHT already provides 14px of clearance above row
// 0 "for free" (the month-label row), so only the remainder needs to be
// reserved here, not the tooltip's full height + gap.
const TOP_MARGIN = Math.max(0, TOOLTIP_HEIGHT + TOOLTIP_GAP - LABEL_HEIGHT);
const TOOLTIP_MARGIN = 4; // min gap kept between the tooltip and the visible viewport's edges
const SELECTED_STROKE = '#111';
const STROKE_PAD = 1; // half of the selected-cell stroke width -- reserved on both edges of the Svg canvas so a selected cell in the leftmost/rightmost column doesn't get its stroke clipped by the canvas boundary

const MONTH_LABELS = MONTH_NAMES.map((m) => m.slice(0, 3));
const LEGEND_SAMPLES = [0, 1, 2, 3, 5]; // one per intensity tier -- intensityColor(3) and (4) share a tier, so 5 is needed to reach the darkest one

function formatCellReadout(cell: HeatmapCell, todayLocal: string): string {
    return `${cell.count} ride${cell.count === 1 ? '' : 's'} on ${friendlyDateLocal(cell.date, todayLocal)}.`;
}

function intensityColor(count: number): string {
    if (count <= 0) return '#ebedf0';
    if (count === 1) return '#c6e9c9';
    if (count === 2) return '#7fcf88';
    if (count <= 4) return '#3d9a5c';
    return '#1f6b3a';
}

type Props = { dayCounts: DayCount[] };

export function RideHeatmap({ dayCounts }: Props) {
    const scrollRef = useRef<ScrollView>(null);
    const todayLocal = useMemo(() => localDateString(), []);
    const [selectedCell, setSelectedCell] = useState<HeatmapCell | null>(null);
    const [tooltipLayout, setTooltipLayout] = useState({ left: 0, top: 0, width: TOOLTIP_MIN_WIDTH });

    // Read at tap-time to position the tooltip, not tracked in state -- the
    // scroll position doesn't need to trigger a re-render on its own, only
    // when a tap actually happens.
    const scrollXRef = useRef(0);
    function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
        scrollXRef.current = e.nativeEvent.contentOffset.x;
    }

    // Seeded from the screen width (Profile's content container is `padding:
    // 20` each side) so there's no visible reflow in the common case before
    // the real onLayout measurement lands.
    const [containerWidth, setContainerWidth] = useState(() => Dimensions.get('window').width - 40);

    const weeksBack = useMemo(() => {
        const earliest = dayCounts[0]?.date; // bucketRidesByLocalDay sorts ascending
        const weeksForHistory = earliest
            ? Math.min(MAX_WEEKS_BACK, Math.ceil(daysBetweenLocal(earliest, todayLocal) / 7) + 1)
            : MIN_WEEKS_BACK;
        // Extra columns beyond real history just render as ordinary 0-count
        // gray cells (buildHeatmapWeeks already densely zero-fills) -- this
        // is what makes the grid fill the full screen width even for a
        // rider with little history yet, instead of trailing off into blank
        // page space.
        const weeksForWidth = Math.ceil(containerWidth / STEP);
        return Math.min(MAX_WEEKS_BACK, Math.max(MIN_WEEKS_BACK, weeksForWidth, weeksForHistory));
    }, [dayCounts, todayLocal, containerWidth]);

    const weeks = useMemo(() => buildHeatmapWeeks(dayCounts, todayLocal, weeksBack), [dayCounts, todayLocal, weeksBack]);

    const monthLabels = useMemo(() => {
        const labels: { weekIndex: number; label: string }[] = [];
        let lastMonth = -1;
        weeks.forEach((week, wi) => {
            const [year, monthStr] = week[0].date.split('-');
            const month = Number(monthStr);
            if (month !== lastMonth) {
                // The year only ever changes at the January boundary in a
                // monotonically-forward window, so marking it there alone is
                // enough to disambiguate a repeated month label across a
                // multi-year span (this window can run up to ~2 years).
                const label = month === 1 ? `${MONTH_LABELS[0]} '${year.slice(2)}` : MONTH_LABELS[month - 1];
                labels.push({ weekIndex: wi, label });
                lastMonth = month;
            }
        });
        return labels;
    }, [weeks]);

    const gridWidth = weeks.length * STEP;
    const gridHeight = LABEL_HEIGHT + 7 * STEP;
    const svgWidth = gridWidth + STROKE_PAD * 2; // extra canvas room so a selected edge column's stroke isn't clipped by the Svg boundary

    // Tapping the already-selected cell deselects it; tapping a different
    // one moves the selection (and the tooltip) there. `wi`/`di` (the
    // cell's column/row) plus the scroll offset at tap-time is what lets
    // the tooltip float directly over the tapped cell's column, clamped
    // horizontally to whatever's currently visible on screen (a grid can be
    // much wider than the phone) and always positioned just above that
    // cell's row -- overlapping the grid itself for every row but the top
    // one, which sits within the fixed TOP_MARGIN instead.
    function handleCellPress(cell: HeatmapCell, wi: number, di: number) {
        if (selectedCell?.date === cell.date) {
            setSelectedCell(null);
            return;
        }
        // Sized to this specific cell's own text (not a fixed constant) so
        // the box is always wide enough to hold it on one line -- a fixed
        // width forced a wrap for longer month names (e.g. "September"),
        // which grew the box downward over the selected cell.
        const text = formatCellReadout(cell, todayLocal);
        const width = Math.max(TOOLTIP_MIN_WIDTH, Math.ceil(text.length * TOOLTIP_CHAR_WIDTH) + TOOLTIP_H_PADDING * 2);

        const idealLeft = wi * STEP + STROKE_PAD + CELL / 2 - width / 2;
        const viewportLeft = scrollXRef.current;
        const viewportRight = viewportLeft + containerWidth;
        const left = Math.max(
            viewportLeft + TOOLTIP_MARGIN,
            Math.min(idealLeft, viewportRight - width - TOOLTIP_MARGIN)
        );
        const cellTop = TOP_MARGIN + LABEL_HEIGHT + di * STEP;
        const top = cellTop - TOOLTIP_GAP - TOOLTIP_HEIGHT;
        setTooltipLayout({ left, top, width });
        setSelectedCell(cell);
    }

    return (
        <View
            onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                setContainerWidth((prev) => (prev === w ? prev : w));
            }}
        >
            <ScrollView
                ref={scrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
            >
                <View style={{ width: svgWidth }}>
                    <Svg width={svgWidth} height={gridHeight} style={{ marginTop: TOP_MARGIN }}>
                        {monthLabels.map(({ weekIndex, label }) => (
                            <SvgText key={weekIndex} x={weekIndex * STEP + STROKE_PAD} y={10} fontSize={9} fill="#888">
                                {label}
                            </SvgText>
                        ))}
                        {weeks.map((week, wi) =>
                            week.map((cell, di) => {
                                const selected = selectedCell?.date === cell.date;
                                return (
                                    <G key={`${wi}-${di}`}>
                                        {/* Full-STEP, invisible hit target -- the visible 11px cell is
                                            well under any reasonable touch-target size, so tapping
                                            anywhere in the 14px pitch (including the gap) should count.
                                            fill="transparent", not "none" -- RNSVG only hit-tests visible
                                            area. */}
                                        <Rect
                                            x={wi * STEP + STROKE_PAD}
                                            y={LABEL_HEIGHT + di * STEP}
                                            width={STEP}
                                            height={STEP}
                                            fill="transparent"
                                            onPress={() => handleCellPress(cell, wi, di)}
                                        />
                                        <Rect
                                            x={wi * STEP + STROKE_PAD}
                                            y={LABEL_HEIGHT + di * STEP}
                                            width={CELL}
                                            height={CELL}
                                            rx={2}
                                            fill={intensityColor(cell.count)}
                                            stroke={selected ? SELECTED_STROKE : 'none'}
                                            strokeWidth={selected ? 2 : 0}
                                            pointerEvents="none"
                                        />
                                    </G>
                                );
                            })
                        )}
                    </Svg>

                    {/* Rendered after (so on top of) the Svg -- overlaps the grid
                        itself for every row but the top one, matching GitHub's
                        look, rather than living in its own dedicated strip. */}
                    {selectedCell && (
                        <View style={[styles.tooltip, tooltipLayout]}>
                            <Text style={styles.tooltipText} numberOfLines={1}>
                                {formatCellReadout(selectedCell, todayLocal)}
                            </Text>
                        </View>
                    )}
                </View>
            </ScrollView>

            <View style={styles.legendRow}>
                <Text style={styles.legendLabel}>Less</Text>
                {LEGEND_SAMPLES.map((count) => (
                    <View key={count} style={[styles.legendSwatch, { backgroundColor: intensityColor(count) }]} />
                ))}
                <Text style={styles.legendLabel}>More</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    legendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 8 },
    legendLabel: { fontSize: 11, color: '#888' },
    legendSwatch: { width: CELL, height: CELL, borderRadius: 2 },
    tooltip: {
        position: 'absolute',
        backgroundColor: '#1a1a1a',
        borderRadius: 6,
        paddingHorizontal: TOOLTIP_H_PADDING,
        paddingVertical: 4,
    },
    tooltipText: { fontSize: 11, color: '#fff', textAlign: 'center' },
});

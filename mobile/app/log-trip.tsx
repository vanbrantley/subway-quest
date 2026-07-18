// mobile/app/log-trip.tsx
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LINE_COLORS } from '../constants/lineColors';
import { LINE_ICONS } from '../constants/lineIcons';
import { TripChipStrip } from '../components/trip-logging/TripChipStrip';
import { StationPickerStep } from '../components/trip-logging/StationPickerStep';
import {
    getDisplayableRoutes,
    getStationIdsForRoute,
    getValidExitStations,
    getDefaultExitStation,
    getTransferRoutes,
    getComplexId,
    getEntryStopForTransfer,
} from '../lib/subwayData';
import type { DraftLeg, ActiveField } from '../components/trip-logging/types';

const AVAILABLE_ROUTES = getDisplayableRoutes();

function getTransferEntryStop(priorLeg: DraftLeg | undefined, routeId: string): string | null {
    if (!priorLeg?.exitStationId) return null;
    const complexId = getComplexId(priorLeg.exitStationId);
    return complexId ? getEntryStopForTransfer(complexId, routeId) : null;
}

export default function LogTripModal() {
    const insets = useSafeAreaInsets();
    const [pickedDate, setPickedDate] = useState(new Date());
    const [legs, setLegs] = useState<DraftLeg[]>([]);
    const [active, setActive] = useState<ActiveField>({ step: 'line', legIndex: 0 });
    const [tripFinished, setTripFinished] = useState(false); // stub flag — real commit is next
    const [transferExpanded, setTransferExpanded] = useState(false);
    const today = new Date();

    // The single place any leg's data is ever written. Truncating to legIndex before
    // appending is what makes the cascade rule real, structurally — not something
    // each caller below has to remember to do correctly on its own.
    function commitLeg(legIndex: number, updatedLeg: DraftLeg) {
        setLegs((prev) => [...prev.slice(0, legIndex), updatedLeg]);
    }

    function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
        if (selectedDate) setPickedDate(selectedDate);
    }

    function handleChipTap(legIndex: number, field: 'line' | 'entry' | 'exit') {
        // A transfer leg's entry is fully determined the moment its line is picked —
        // nothing to reopen. A mixup gets fixed via the line chip instead.
        if (field === 'entry' && legIndex > 0) return;

        setTripFinished(false);
        setActive({ step: field, legIndex });
    }

    function selectLine(routeId: string) {
        const legIndex = active.legIndex;

        if (legIndex === 0) {
            commitLeg(legIndex, { routeId, entryStationId: null, exitStationId: null });
            setActive({ step: 'entry', legIndex });
            return;
        }

        // Transfer leg, re-picked via its line chip — entry re-derives from the leg
        // before it, same as a freshly-added transfer would.
        const entryStopId = getTransferEntryStop(legs[legIndex - 1], routeId);
        commitLeg(legIndex, { routeId, entryStationId: entryStopId, exitStationId: null });
        setActive({ step: 'exit', legIndex });
    }

    function selectEntry(stopId: string) {
        const legIndex = active.legIndex;
        commitLeg(legIndex, { ...legs[legIndex], entryStationId: stopId, exitStationId: null });
        setActive({ step: 'exit', legIndex });
    }

    function selectExit(stopId: string) {
        const legIndex = active.legIndex;
        commitLeg(legIndex, { ...legs[legIndex], exitStationId: stopId });
        setTransferExpanded(false);
        setActive({ step: 'transfer', legIndex });
    }

    function selectTransfer(routeId: string) {
        const finishedLeg = legs[active.legIndex];
        const entryStopId = getTransferEntryStop(finishedLeg, routeId);
        const nextLegIndex = active.legIndex + 1;
        commitLeg(nextLegIndex, { routeId, entryStationId: entryStopId, exitStationId: null });
        setActive({ step: 'exit', legIndex: nextLegIndex });
    }

    function finishTrip() {
        setTripFinished(true); // stub — real commit/discard wiring is the next chunk
    }

    const currentLeg = legs[active.legIndex];

    const lineOptions =
        active.step === 'line' && active.legIndex > 0
            ? getTransferRoutes(
                legs[active.legIndex - 1]?.routeId ?? '',
                legs[active.legIndex - 1]?.exitStationId ?? ''
            )
            : AVAILABLE_ROUTES;

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable onPress={() => router.back()} accessibilityLabel="Discard and close">
                    <Ionicons name="close" size={28} color="#111" />
                </Pressable>
                <Text style={styles.title}>Log Trip</Text>
                <View style={{ width: 28 }} />
            </View>

            <View style={styles.dateRow}>
                <DateTimePicker
                    value={pickedDate}
                    mode="date"
                    display="compact"
                    maximumDate={today}
                    onChange={handleDateChange}
                />
            </View>

            <TripChipStrip legs={legs} onTapChip={handleChipTap} />

            <View style={styles.activeArea}>
                {active.step === 'line' && (
                    <>
                        <Text style={styles.label}>
                            {active.legIndex === 0 ? 'Which line did you start on?' : 'Transfer to which line?'}
                        </Text>
                        {lineOptions.length > 0 ? (
                            <ScrollView contentContainerStyle={styles.grid} style={styles.gridScroll}>
                                {lineOptions.map((routeId) => {
                                    const Icon = LINE_ICONS[routeId];
                                    const isSelected = legs[active.legIndex]?.routeId === routeId;
                                    return (
                                        <Pressable
                                            key={routeId}
                                            style={[styles.bubble, isSelected && styles.bubbleSelected]}
                                            onPress={() => selectLine(routeId)}
                                        >
                                            {Icon ? (
                                                <Icon width={44} height={44} />
                                            ) : (
                                                <View style={[styles.colorBubble, { backgroundColor: LINE_COLORS[routeId]?.bg ?? '#ccc' }]}>
                                                    <Text style={[styles.colorBubbleText, { color: LINE_COLORS[routeId]?.text ?? '#000' }]}>
                                                        {routeId}
                                                    </Text>
                                                </View>
                                            )}
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                        ) : (
                            <Text style={styles.noTransfersText}>No transfers available here</Text>
                        )}
                    </>
                )}

                {active.step === 'entry' && currentLeg && (
                    <StationPickerStep
                        key={`entry-${active.legIndex}`}
                        label={`Where did you board the ${currentLeg.routeId}?`}
                        options={getStationIdsForRoute(currentLeg.routeId)}
                        initialValue={currentLeg.entryStationId}
                        onConfirm={selectEntry}
                    />
                )}

                {active.step === 'exit' && currentLeg?.entryStationId && (
                    <StationPickerStep
                        key={`exit-${active.legIndex}`}
                        label="Where did you get off?"
                        options={getValidExitStations(currentLeg.routeId, currentLeg.entryStationId)}
                        initialValue={
                            currentLeg.exitStationId ??
                            getDefaultExitStation(currentLeg.routeId, currentLeg.entryStationId)
                        }
                        onConfirm={selectExit}
                    />
                )}

                {active.step === 'transfer' && currentLeg?.exitStationId && !tripFinished && (
                    <View style={styles.transferSection}>
                        {!transferExpanded ? (
                            <View style={styles.postExitStack}>
                                <Pressable style={styles.addTransferButton} onPress={() => setTransferExpanded(true)}>
                                    <Ionicons name="add" size={20} color="#444" />
                                    <Text style={styles.addTransferButtonText}>Add Transfer</Text>
                                </Pressable>
                                <Pressable style={styles.finishButton} onPress={finishTrip}>
                                    <Text style={styles.finishButtonText}>Log Trip</Text>
                                </Pressable>
                            </View>
                        ) : (
                            <>
                                <Text style={styles.label}>Transfer to which line?</Text>
                                {(() => {
                                    const transferRoutes = getTransferRoutes(currentLeg.routeId, currentLeg.exitStationId);
                                    return transferRoutes.length > 0 ? (
                                        <ScrollView contentContainerStyle={styles.grid} style={styles.gridScroll}>
                                            {transferRoutes.map((routeId) => {
                                                const Icon = LINE_ICONS[routeId];
                                                return (
                                                    <Pressable key={routeId} style={styles.bubble} onPress={() => selectTransfer(routeId)}>
                                                        {Icon ? (
                                                            <Icon width={44} height={44} />
                                                        ) : (
                                                            <View style={[styles.colorBubble, { backgroundColor: LINE_COLORS[routeId]?.bg ?? '#ccc' }]}>
                                                                <Text style={[styles.colorBubbleText, { color: LINE_COLORS[routeId]?.text ?? '#000' }]}>
                                                                    {routeId}
                                                                </Text>
                                                            </View>
                                                        )}
                                                    </Pressable>
                                                );
                                            })}
                                        </ScrollView>
                                    ) : (
                                        <Text style={styles.noTransfersText}>No transfers available here</Text>
                                    );
                                })()}
                                <Pressable style={[styles.finishButton, styles.finishButtonSpaced]} onPress={finishTrip}>
                                    <Text style={styles.finishButtonText}>Log Trip</Text>
                                </Pressable>
                            </>
                        )}
                    </View>
                )}

                {tripFinished && <Text style={styles.label}>Trip complete — commit/discard coming next</Text>}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    title: { fontSize: 17, fontWeight: '600' },
    dateRow: { alignItems: 'center', paddingBottom: 8 },
    activeArea: { flex: 1, paddingTop: 16 },
    transferSection: { flex: 1, alignItems: 'center' },
    label: { fontSize: 15, color: '#444', textAlign: 'center', marginVertical: 16 },
    noTransfersText: { fontSize: 14, color: '#999', textAlign: 'center', marginVertical: 20 },
    gridScroll: { flexGrow: 0, width: '100%' },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 12,
        paddingHorizontal: 20,
    },
    bubble: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
    bubbleSelected: { borderWidth: 3, borderColor: '#111', borderRadius: 22 },
    colorBubble: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    colorBubbleText: { fontWeight: '700', fontSize: 16 },
    postExitStack: { alignItems: 'center', gap: 16, marginTop: 32 },
    addTransferButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 14,
        paddingHorizontal: 28,
        borderRadius: 26,
        borderWidth: 1,
        borderColor: '#ccc',
    },
    addTransferButtonText: { fontWeight: '600', color: '#444', fontSize: 16 },
    finishButton: { paddingVertical: 14, paddingHorizontal: 36, backgroundColor: '#111', borderRadius: 26 },
    finishButtonSpaced: { marginTop: 24 },
    finishButtonText: { fontWeight: '600', color: '#fff', fontSize: 16 },
});
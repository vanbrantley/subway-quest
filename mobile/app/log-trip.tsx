// mobile/app/log-trip.tsx
import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { LINE_COLORS } from '../constants/lineColors';
import { LINE_ICONS } from '../constants/lineIcons';
import { TripChipStrip } from '../components/trip-logging/TripChipStrip';
import { StationPickerStep } from '../components/trip-logging/StationPickerStep';
import { useDb } from '../contexts/DatabaseContext';
import { useUserId } from '../contexts/AuthContext';
import { getOrCreateDeviceId } from '../lib/device';
import { commitTrip, writeProductEvent, localDateString, type TripDraft } from '../db/projection';
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
    const db = useDb();
    const userId = useUserId();
    const draftId = useMemo(() => randomUUID(), []);
    const [pickedDate, setPickedDate] = useState(new Date());
    const [legs, setLegs] = useState<DraftLeg[]>([]);
    const [active, setActive] = useState<ActiveField>({ step: 'line', legIndex: 0 });
    const [transferExpanded, setTransferExpanded] = useState(false);
    const today = new Date();

    useEffect(() => {
        (async () => {
            const deviceId = await getOrCreateDeviceId();
            await writeProductEvent(db, 'trip_draft_started', { draft_id: draftId }, { deviceId, userId });
        })();
    }, [db, draftId, userId]);

    // The single place any leg's data is ever written — also the single place
    // draft_leg_added/draft_leg_removed get decided, scoped to *completeness*
    // (exitStationId set), not individual field writes. State update happens
    // synchronously first; analytics writes are fire-and-forget afterward so a
    // slow SQLite write never delays the UI truncation.
    function commitLeg(legIndex: number, updatedLeg: DraftLeg) {
        const discarded = legs.slice(legIndex); // old legs about to be cut, incl. legIndex's old value
        setLegs([...legs.slice(0, legIndex), updatedLeg]);
        logLegChange(legIndex, discarded, updatedLeg);
    }

    async function logLegChange(legIndex: number, discarded: DraftLeg[], updatedLeg: DraftLeg) {
        try {
            const deviceId = await getOrCreateDeviceId();
            const ctx = { deviceId, userId };

            // Only a leg that had genuinely reached "complete" and then got cut
            // counts as a real correction — a leg still mid-pick (no exit yet)
            // being truncated is normal in-progress editing, not a correction.
            for (let i = 0; i < discarded.length; i++) {
                if (discarded[i].exitStationId !== null) {
                    await writeProductEvent(db, 'draft_leg_removed', { draft_id: draftId, sequence: legIndex + i + 1 }, ctx);
                }
            }

            if (updatedLeg.exitStationId !== null) {
                await writeProductEvent(db, 'draft_leg_added', { draft_id: draftId, sequence: legIndex + 1 }, ctx);
            }
        } catch (err) {
            console.error('Failed to log draft leg event:', err);
        }
    }

    function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
        if (selectedDate) setPickedDate(selectedDate);
    }

    function handleChipTap(legIndex: number, field: 'line' | 'entry' | 'exit') {
        if (field === 'entry' && legIndex > 0) return;
        setActive({ step: field, legIndex });
    }

    function selectLine(routeId: string) {
        const legIndex = active.legIndex;

        if (legIndex === 0) {
            commitLeg(legIndex, { routeId, entryStationId: null, exitStationId: null });
            setActive({ step: 'entry', legIndex });
            return;
        }

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

    async function finishTrip() {
        const draft: TripDraft = {
            originStationId: legs[0].entryStationId!,
            destinationStationId: legs[legs.length - 1].exitStationId!,
            pickedDate: localDateString(pickedDate),
            legs: legs.map((leg, i) => ({
                sequence: i + 1,
                routeId: leg.routeId,
                entryStationId: leg.entryStationId!,
                exitStationId: leg.exitStationId!,
            })),
        };
        const deviceId = await getOrCreateDeviceId();
        const ctx = { deviceId, userId };
        const tripId = await commitTrip(db, draft, ctx);
        await writeProductEvent(db, 'trip_draft_committed', { draft_id: draftId, trip_id: tripId }, ctx);
        router.replace({ pathname: '/trip', params: { tripId } });
    }

    async function discardDraft() {
        if (legs.length > 0) {
            const deviceId = await getOrCreateDeviceId();
            await writeProductEvent(db, 'trip_draft_abandoned', { draft_id: draftId }, { deviceId, userId });
        }
        router.back();
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
                <Pressable onPress={discardDraft} accessibilityLabel="Discard and close">
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

                {active.step === 'transfer' && currentLeg?.exitStationId && (
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
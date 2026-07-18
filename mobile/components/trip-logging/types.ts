// mobile/components/trip-logging/types.ts
export type DraftLeg = {
    routeId: string;
    entryStationId: string | null;
    exitStationId: string | null;
};

export type ActiveField =
    | { step: 'line'; legIndex: number }
    | { step: 'entry'; legIndex: number }
    | { step: 'exit'; legIndex: number }
    | { step: 'transfer'; legIndex: number }; // "transfer, or finish the trip?" —
// shown right after a leg's exit is confirmed
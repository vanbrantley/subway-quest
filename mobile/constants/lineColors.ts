// mobile/constants/lineColors.ts
//
// Official MTA route colors — not present in any of the bundled data files, and
// stable enough (unchanged in decades) to hardcode rather than derive from anything.

export const LINE_COLORS: Record<string, { bg: string; text: string }> = {
    '1': { bg: '#EE352E', text: '#fff' },
    '2': { bg: '#EE352E', text: '#fff' },
    '3': { bg: '#EE352E', text: '#fff' },
    '4': { bg: '#00933C', text: '#fff' },
    '5': { bg: '#00933C', text: '#fff' },
    '6': { bg: '#00933C', text: '#fff' },
    '7': { bg: '#B933AD', text: '#fff' },
    A: { bg: '#0039A6', text: '#fff' },
    C: { bg: '#0039A6', text: '#fff' },
    E: { bg: '#0039A6', text: '#fff' },
    B: { bg: '#FF6319', text: '#fff' },
    D: { bg: '#FF6319', text: '#fff' },
    F: { bg: '#FF6319', text: '#fff' },
    M: { bg: '#FF6319', text: '#fff' },
    G: { bg: '#6CBE45', text: '#fff' },
    J: { bg: '#996633', text: '#fff' },
    Z: { bg: '#996633', text: '#fff' },
    L: { bg: '#A7A9AC', text: '#fff' },
    N: { bg: '#FCCC0A', text: '#000' }, // yellow lines get black text — standard
    Q: { bg: '#FCCC0A', text: '#000' }, // MTA convention for contrast
    R: { bg: '#FCCC0A', text: '#000' },
    W: { bg: '#FCCC0A', text: '#000' },
    S: { bg: '#808183', text: '#fff' },
    SI: { bg: '#0039A6', text: '#fff' },
};

// Standard MTA display order: numbers first, then shuttles, then letters.
export function sortRouteIds(routeIds: string[]): string[] {
    const order = (id: string) => {
        if (/^\d+$/.test(id)) return [0, Number(id)] as const;
        if (id === 'S') return [1, 0] as const;
        if (id === 'SI') return [1, 1] as const;
        return [2, id.charCodeAt(0)] as const;
    };
    return [...routeIds].sort((a, b) => {
        const [ag, an] = order(a);
        const [bg, bn] = order(b);
        return ag !== bg ? ag - bg : an - bn;
    });
}
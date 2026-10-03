/** Values the orchestrator's summary may mention, all taken from the evidence. */
export interface GroundingAllowList {
    clauses: Set<string>;
    flightNumbers: Set<string>;
    /** Local times, "HH:mm". UTC times are deliberately absent: quoting them as local time is the error to catch. */
    times: Set<string>;
    dates: Set<string>;
    amounts: Set<number>;
    minutes: Set<number>;
}

export interface GroundingResult {
    grounded: boolean;
    /** Values the summary states that the evidence doesn't support, e.g. ["time 05:05", "clause 9.9"]. */
    unsupported: string[];
}

interface ValueCheck {
    kind: string;
    pattern: RegExp;
    /** Normalised value from a match, or null when the match isn't one (e.g. "AB-CD"). */
    read: (match: RegExpMatchArray) => string | null;
    isAllowed: (value: string, allowed: GroundingAllowList) => boolean;
}

const CHECKS: ValueCheck[] = [
    {
        kind: 'clause',
        pattern: /(?:§\s?|clause\s+)(\d+\.\d+)/gi,
        read: ([, id]) => id,
        isAllowed: (id, allowed) => allowed.clauses.has(id),
    },
    {
        kind: 'flight',
        pattern: /\b(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])[\s-]?\d{2,4}\b/g,
        read: ([match]) => {
            const normalised = match.replace(/[\s-]/g, '');
            return /\d{2}/.test(normalised) ? normalised : null;
        },
        isAllowed: (flight, allowed) => allowed.flightNumbers.has(flight),
    },
    {
        kind: 'time',
        pattern: /\b([01]?\d|2[0-3]):([0-5]\d)\b/g,
        read: ([, hours, minutes]) => `${hours.padStart(2, '0')}:${minutes}`,
        isAllowed: (time, allowed) => allowed.times.has(time),
    },
    {
        kind: 'date',
        pattern: /\b\d{4}-\d{2}-\d{2}\b/g,
        read: ([date]) => date,
        isAllowed: (date, allowed) => allowed.dates.has(date),
    },
    {
        kind: 'amount',
        pattern: /(?:INR|₹|Rs\.?)\s?([\d,]+)/gi,
        read: ([, amount]) => String(Number(amount.replace(/,/g, ''))),
        isAllowed: (amount, allowed) => allowed.amounts.has(Number(amount)),
    },
    {
        kind: 'minutes',
        pattern: /\b(\d{1,4})[\s-]?(?:minutes?|mins?)\b/gi,
        read: ([, minutes]) => minutes,
        isAllowed: (minutes, allowed) => allowed.minutes.has(Number(minutes)),
    },
];

/**
 * Checks that every specific fact in a model-written summary (clause, flight number, time, date, amount,
 * minutes) appears in the evidence. Catches invented or mis-converted values; can't judge wording.
 * @param text Summary to check.
 * @param allowed Values supported by the evidence.
 */
export function checkGrounding(text: string, allowed: GroundingAllowList): GroundingResult {
    const unsupported = CHECKS.flatMap(({ kind, pattern, read, isAllowed }) =>
        [...text.matchAll(pattern)]
            .map(read)
            .filter((value): value is string => value !== null && !isAllowed(value, allowed))
            .map((value) => `${kind} ${value}`),
    );
    return { grounded: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}

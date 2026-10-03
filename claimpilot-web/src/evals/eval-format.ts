/**
 * Formats a 0–1 rate as a percentage with one decimal.
 * @param value Rate.
 */
export function percent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

/**
 * Short local date and time of a run, e.g. "3 Oct, 09:32".
 * @param iso ISO instant.
 */
export function runTime(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

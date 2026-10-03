/**
 * Calendar date (YYYY-MM-DD) of an instant in a time zone. 01:30 in India on 2 Oct is still
 * 1 Oct in UTC, so "today" and "submitted on" must be computed in the claimant's zone.
 * @param instant Moment in time.
 * @param timeZone IANA time zone, e.g. "Asia/Kolkata".
 */
export function localDate(instant: Date, timeZone: string): string {
    // en-CA formats dates as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        instant,
    );
}

/**
 * Local date and time with the zone, e.g. "2026-09-24 18:40 Asia/Kolkata". Used whenever times are shown
 * to a model or a person, so a UTC timestamp is never mistaken for local time.
 * @param iso ISO 8601 instant.
 * @param timeZone IANA time zone.
 */
export function localDateTime(iso: string, timeZone: string): string {
    const time = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(new Date(iso));
    return `${localDate(new Date(iso), timeZone)} ${time} ${timeZone}`;
}

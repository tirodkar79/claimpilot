import { localDate, localDateTime } from './local-date';

describe('localDate', () => {
    it('uses the time zone, not UTC', () => {
        const instant = new Date('2026-10-01T20:00:00Z'); // 01:30 on 2 Oct in India
        expect(localDate(instant, 'Asia/Kolkata')).toBe('2026-10-02');
        expect(localDate(instant, 'UTC')).toBe('2026-10-01');
    });

    it('pads months and days', () => {
        expect(localDate(new Date('2026-03-05T12:00:00Z'), 'UTC')).toBe('2026-03-05');
    });
});

describe('localDateTime', () => {
    it('shows local time with the zone name', () => {
        expect(localDateTime('2026-09-24T13:10:00.000Z', 'Asia/Kolkata')).toBe('2026-09-24 18:40 Asia/Kolkata');
    });

    it('rolls over to the next local day', () => {
        expect(localDateTime('2026-09-24T18:55:00.000Z', 'Asia/Kolkata')).toBe('2026-09-25 00:25 Asia/Kolkata');
    });
});

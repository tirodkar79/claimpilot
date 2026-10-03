import type { Booking } from './booking.schema';

/** Fictional demo bookings, one per integrity scenario. */
export const BOOKING_SEEDS: Omit<Booking, '_id'>[] = [
    { bookingRef: 'XK9P2L', flightNumber: '6E2134', passengerCustomerIds: ['C-1042'] },
    { bookingRef: 'QP7Y4M', flightNumber: 'QP1303', passengerCustomerIds: ['C-2077'] },
    { bookingRef: 'LT3001', flightNumber: '6E2134', passengerCustomerIds: ['C-3001'] },
    // Someone else's booking: a claim by C-1042 quoting it is flagged "not on booking".
    { bookingRef: 'ZZ9999', flightNumber: 'AI865', passengerCustomerIds: ['C-5555'] },
];

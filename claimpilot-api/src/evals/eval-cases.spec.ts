import { Types } from 'mongoose';
import type { Claim } from '../claims/claim.schema';
import { reviewedCase } from './eval-cases';

describe('reviewedCase', () => {
    it("turns a reviewed claim into a case expecting the reviewer's decision", () => {
        const _id = new Types.ObjectId('6ac07dafd5342c9ff9258add');
        const claim = {
            _id,
            customerId: 'C-3001',
            policyId: 'P-60',
            bookingRef: 'LT3001',
            message: '6E-2134 delayed 4 hours',
            review: { status: 'resolved', decision: 'APPROVE', note: 'Renewal bought late by mistake.' },
        } as unknown as Claim;

        expect(reviewedCase(claim)).toEqual({
            id: 'reviewed-6ac07dafd5342c9ff9258add',
            title: 'Reviewed claim 258add',
            tests: 'Agreement with the reviewer: "Renewal bought late by mistake."',
            source: 'review',
            input: { customerId: 'C-3001', policyId: 'P-60', bookingRef: 'LT3001', message: '6E-2134 delayed 4 hours' },
            expect: { decision: 'APPROVE' },
        });
    });
});

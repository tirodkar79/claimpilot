import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { ApiError } from '../api/api-error';
import { createClaim, type CreateClaimRequest } from './claims.api';
import styles from './NewClaimPage.module.css';

const EMPTY: CreateClaimRequest = { customerId: '', policyId: '', bookingRef: '', message: '' };

/** Prefilled claims for demos: one complete, one missing the date and delay. */
const EXAMPLES: { label: string; claim: CreateClaimRequest }[] = [
    {
        label: 'Complete claim',
        claim: {
            customerId: 'C-1042',
            policyId: 'P-77',
            bookingRef: 'XK9P2L',
            message:
                'My flight 6E-2134 from Mumbai to Delhi on 12 Sep was delayed 4 hours because of fog. ' +
                'I want to claim the delay benefit.',
        },
    },
    {
        label: 'Missing details',
        claim: {
            customerId: 'C-1042',
            policyId: 'P-77',
            bookingRef: '',
            message: 'My IndiGo flight to Delhi was badly delayed and I missed a meeting. Please compensate me.',
        },
    },
];

/** Claim submission form. On success it opens the live triage view of the new claim. */
export function NewClaimPage() {
    const navigate = useNavigate();
    const [form, setForm] = useState<CreateClaimRequest>(EMPTY);
    const submit = useMutation<Awaited<ReturnType<typeof createClaim>>, ApiError, CreateClaimRequest>({
        mutationFn: createClaim,
        onSuccess: (claim) => navigate(`/claims/${claim.id}`),
    });

    /**
     * Updates one form field.
     * @param field Field name.
     * @param value New value.
     */
    const update = (field: keyof CreateClaimRequest, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

    /**
     * Submits the claim, dropping an empty booking reference.
     * @param event Form submit event.
     */
    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        submit.mutate({ ...form, bookingRef: form.bookingRef?.trim() || undefined });
    };

    return (
        <form className={styles.card} onSubmit={onSubmit} noValidate>
            <div>
                <div className={styles.eyebrow}>New claim</div>
                <h2 className={styles.heading}>Tell us what happened</h2>
            </div>

            <div className={styles.examples}>
                <span className={styles.label}>Load an example</span>
                {EXAMPLES.map((example) => (
                    <button
                        key={example.label}
                        type="button"
                        className={styles.chip}
                        onClick={() => setForm(example.claim)}
                    >
                        {example.label}
                    </button>
                ))}
            </div>

            <div className={styles.row}>
                <label className={styles.field}>
                    <span className={styles.label}>Customer</span>
                    <input
                        className={styles.input}
                        value={form.customerId}
                        onChange={(e) => update('customerId', e.target.value)}
                        placeholder="C-1042"
                        required
                    />
                </label>
                <label className={styles.field}>
                    <span className={styles.label}>Policy</span>
                    <input
                        className={styles.input}
                        value={form.policyId}
                        onChange={(e) => update('policyId', e.target.value)}
                        placeholder="P-77"
                        required
                    />
                </label>
                <label className={styles.field}>
                    <span className={styles.label}>Booking ref (optional)</span>
                    <input
                        className={styles.input}
                        value={form.bookingRef}
                        onChange={(e) => update('bookingRef', e.target.value)}
                        placeholder="XK9P2L"
                    />
                </label>
            </div>

            <label className={styles.field}>
                <span className={styles.label}>Your message</span>
                <textarea
                    className={styles.textarea}
                    value={form.message}
                    onChange={(e) => update('message', e.target.value)}
                    placeholder="Flight number, date, how long the delay was and what you were told."
                    rows={6}
                    required
                />
            </label>

            {submit.error && (
                <div className={styles.error} role="alert">
                    <b>{submit.error.message}</b>
                    {Array.isArray(submit.error.details) && (
                        <ul>
                            {(submit.error.details as { path: string; message: string }[]).map((detail) => (
                                <li key={detail.path}>
                                    {detail.path}: {detail.message}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <div className={styles.actions}>
                <button type="submit" className={styles.primary} disabled={submit.isPending}>
                    {submit.isPending ? 'Submitting…' : 'Run triage'}
                    <ArrowRight size={16} strokeWidth={1.8} />
                </button>
            </div>
        </form>
    );
}

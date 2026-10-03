import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { ApiError } from '../../api/api-error';
import { addClaimDetails } from '../claims.api';
import styles from './triage.module.css';

interface NeedInfoReplyProps {
    claimId: string;
    /** Called once the details are accepted and triage has restarted. */
    onSent: () => void;
}

/** The claimant's answer to a NEED_INFO outcome. Sending it triages the same claim again. */
export function NeedInfoReply({ claimId, onSent }: NeedInfoReplyProps) {
    const [details, setDetails] = useState('');
    const send = useMutation<unknown, ApiError, string>({
        mutationFn: (message) => addClaimDetails(claimId, message),
        onSuccess: () => {
            setDetails('');
            onSent();
        },
    });

    /**
     * Sends the details.
     * @param event Form submit event.
     */
    const submit = (event: FormEvent) => {
        event.preventDefault();
        send.mutate(details.trim());
    };

    return (
        <form className={`${styles.card} ${styles.reply}`} onSubmit={submit}>
            <h3 className={styles.cardTitle}>Reply with the missing details</h3>
            <p className={styles.lead}>
                Answer the questions above in your own words. The claim is checked again with your answer added.
            </p>
            <textarea
                className={styles.replyInput}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="e.g. Flight 6E-2134 from Mumbai to Delhi on 30 September"
                aria-label="Missing details"
            />
            {send.isError && (
                <p className={styles.replyError} role="alert">
                    {send.error.message}
                </p>
            )}
            <button type="submit" className={styles.replyButton} disabled={send.isPending || details.trim().length < 2}>
                {send.isPending ? 'Sending…' : 'Send details'}
            </button>
        </form>
    );
}

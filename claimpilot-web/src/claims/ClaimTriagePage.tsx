import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { roleStore } from '../auth/role.store';
import { usePersistedStore } from '../lib/persisted-store';
import { FactsCard } from './triage/FactsCard';
import { FlightCard } from './triage/FlightCard';
import { NeedInfoReply } from './triage/NeedInfoReply';
import { IntegrityCard } from './triage/IntegrityCard';
import { OutcomeCard } from './triage/OutcomeCard';
import { PolicyCard } from './triage/PolicyCard';
import { ReviewCard } from './triage/ReviewCard';
import { TraceLog } from './triage/TraceLog';
import { WeatherCard } from './triage/WeatherCard';
import { useClaim } from './use-claim';
import { useClaimEvents } from './use-claim-events';
import styles from './ClaimTriagePage.module.css';

/** Live view of one claim: what was submitted, what each agent found, the outcome and the trace. */
export function ClaimTriagePage() {
    const { claimId = '' } = useParams();
    const claim = useClaim(claimId);
    const [run, setRun] = useState(0);
    const stream = useClaimEvents(claimId, run);
    const [role] = usePersistedStore(roleStore);
    const queryClient = useQueryClient();
    const waitingForClaimant = claim.data?.status === 'completed' && claim.data.outcome?.decision === 'NEED_INFO';

    /** The claimant answered: show the claim as triaging again and follow the new run. */
    const followNewRun = () => {
        void queryClient.invalidateQueries({ queryKey: ['claim', claimId] });
        setRun((current) => current + 1);
    };

    if (claim.isError) {
        return (
            <p className={styles.error} role="alert">
                {claim.error.message}
            </p>
        );
    }

    return (
        <div className={styles.layout}>
            <div className={styles.column}>
                <section className={styles.summary}>
                    <div className={styles.meta}>
                        <span>{claim.data?.customerId}</span>
                        <span>{claim.data?.policyId}</span>
                        {claim.data?.bookingRef && <span>{claim.data.bookingRef}</span>}
                        <span className={styles.claimId}>claim {claimId.slice(-6)}</span>
                    </div>
                    <blockquote className={styles.message}>{claim.data?.message ?? '…'}</blockquote>
                    {claim.data?.safety?.injectionSuspected && (
                        <p className={styles.injection} role="status">
                            Possible prompt injection (
                            {claim.data.safety.injectionSignals.join(', ').replaceAll('_', ' ')}
                            ). The text was treated as data only; the decision comes from the records and rules.
                        </p>
                    )}
                </section>
                <FactsCard facts={claim.data?.facts} />
                <PolicyCard findings={claim.data?.evidence?.policy} policyId={claim.data?.policyId ?? ''} />
                <FlightCard
                    findings={claim.data?.evidence?.flight}
                    measure={claim.data?.evidence?.policy?.delayMeasure}
                    claimedMinutes={claim.data?.facts?.claimedDelayMinutes}
                    outcome={claim.data?.outcome}
                />
                {claim.data?.evidence?.weather && (
                    <WeatherCard
                        findings={claim.data.evidence.weather}
                        timeZone={claim.data.evidence.flight?.leg?.origin.timeZone ?? 'Asia/Kolkata'}
                    />
                )}
                {claim.data?.evidence?.integrity && <IntegrityCard findings={claim.data.evidence.integrity} />}
                <OutcomeCard
                    outcome={claim.data?.outcome}
                    summary={claim.data?.summary}
                    summaryCheck={claim.data?.safety?.summary}
                />
                {waitingForClaimant && role === 'claimant' && <NeedInfoReply claimId={claimId} onSent={followNewRun} />}
                {waitingForClaimant && role === 'reviewer' && (
                    <p className={styles.waiting}>Waiting for the claimant to reply with the missing details.</p>
                )}
                {claim.data?.review && <ReviewCard review={claim.data.review} />}
            </div>
            <TraceLog events={stream.events} status={stream.status} error={stream.error} />
        </div>
    );
}

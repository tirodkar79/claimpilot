import { useParams } from 'react-router';
import { FactsCard } from './triage/FactsCard';
import { FlightCard } from './triage/FlightCard';
import { IntegrityCard } from './triage/IntegrityCard';
import { OutcomeCard } from './triage/OutcomeCard';
import { PolicyCard } from './triage/PolicyCard';
import { TraceLog } from './triage/TraceLog';
import { WeatherCard } from './triage/WeatherCard';
import { useClaim } from './use-claim';
import { useClaimEvents } from './use-claim-events';
import styles from './ClaimTriagePage.module.css';

/** Live view of one claim: what was submitted, what each agent found, the outcome and the trace. */
export function ClaimTriagePage() {
    const { claimId = '' } = useParams();
    const claim = useClaim(claimId);
    const stream = useClaimEvents(claimId);

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
                <OutcomeCard outcome={claim.data?.outcome} summary={claim.data?.summary} />
            </div>
            <TraceLog events={stream.events} status={stream.status} error={stream.error} />
        </div>
    );
}

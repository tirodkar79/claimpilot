import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { CLAIMS_PAGE_SIZE, listClaims, type ClaimDecision, type ClaimListItem } from './claims.api';
import styles from './ClaimsHistoryPage.module.css';

const DECISION_LABEL: Record<ClaimDecision, { label: string; tone: string }> = {
    APPROVE: { label: 'Approved', tone: styles.ok },
    REJECT: { label: 'Rejected', tone: styles.bad },
    REFER: { label: 'Referred', tone: styles.warn },
    NEED_INFO: { label: 'Need info', tone: styles.info },
};
const REFRESH_WHILE_TRIAGING_MS = 3000;

/**
 * Short local date and time, e.g. "3 Oct, 11:42".
 * @param iso ISO instant.
 */
function submittedAt(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/** Where a claim stands: triaging, the triage decision, or the reviewer's decision once a referral is decided. */
function Outcome({ claim }: { claim: ClaimListItem }) {
    if (claim.status === 'triaging' || !claim.decision) {
        return <span className={`${styles.pill} ${styles.neutral}`}>Triaging…</span>;
    }
    if (claim.reviewStatus === 'resolved' && claim.reviewDecision) {
        const { label, tone } = DECISION_LABEL[claim.reviewDecision];
        return <span className={`${styles.pill} ${tone}`}>{label} · reviewed</span>;
    }
    const { label, tone } = DECISION_LABEL[claim.decision];
    return (
        <span className={`${styles.pill} ${tone}`}>
            {label}
            {claim.reviewStatus === 'pending' && ' · in review'}
        </span>
    );
}

/** Claims history, newest first, with a customer filter kept in the URL (`?customer=C-1042`). */
export function ClaimsHistoryPage() {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const customer = params.get('customer') ?? '';
    const page = Math.max(1, Number(params.get('page')) || 1);

    const claims = useQuery({
        queryKey: ['claims', customer, page],
        queryFn: () => listClaims(customer.trim(), page),
        refetchInterval: (query) =>
            query.state.data?.items.some((item) => item.status === 'triaging') ? REFRESH_WHILE_TRIAGING_MS : false,
    });

    /**
     * Updates the URL: filter and page.
     * @param next Values to set; an empty value removes the parameter.
     */
    const update = (next: { customer?: string; page?: number }) => {
        const nextCustomer = next.customer ?? customer;
        const nextPage = next.page ?? page;
        setParams(
            { ...(nextCustomer && { customer: nextCustomer }), ...(nextPage > 1 && { page: String(nextPage) }) },
            { replace: true },
        );
    };

    const total = claims.data?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / CLAIMS_PAGE_SIZE));

    return (
        <section className={styles.card}>
            <header className={styles.header}>
                <h3 className={styles.title}>
                    Claims <span className={styles.count}>{claims.data ? total : '…'}</span>
                </h3>
                <label className={styles.filter}>
                    Customer
                    <input
                        value={customer}
                        onChange={(event) => update({ customer: event.target.value, page: 1 })}
                        placeholder="All, or e.g. C-1042"
                        spellCheck={false}
                    />
                </label>
            </header>

            {claims.isError && <p className={styles.error}>{claims.error.message}</p>}
            {claims.isSuccess && total === 0 && (
                <p className={styles.muted}>
                    {customer ? `No claims for ${customer}.` : 'No claims yet. Submit one from New claim.'}
                </p>
            )}

            {!!claims.data?.items.length && (
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Submitted</th>
                            <th>Claim</th>
                            <th>Customer</th>
                            <th>Policy</th>
                            <th>Flight</th>
                            <th>Outcome</th>
                            <th className={styles.num}>Payout</th>
                        </tr>
                    </thead>
                    <tbody>
                        {claims.data.items.map((claim) => (
                            <tr key={claim.id} onClick={() => navigate(`/claims/${claim.id}`)}>
                                <td>{submittedAt(claim.createdAt)}</td>
                                <td className={styles.mono}>
                                    <a href={`/claims/${claim.id}`} onClick={(event) => event.preventDefault()}>
                                        {claim.id.slice(-6)}
                                    </a>
                                </td>
                                <td className={styles.mono}>{claim.customerId}</td>
                                <td className={styles.mono}>{claim.policyId}</td>
                                <td className={styles.mono}>
                                    {claim.flightNumber ?? '—'} · {claim.flightDate ?? '—'}
                                </td>
                                <td>
                                    <Outcome claim={claim} />
                                </td>
                                <td className={styles.num}>
                                    {claim.payout
                                        ? `${claim.payout.currency} ${claim.payout.amount.toLocaleString('en-IN')}`
                                        : '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {pages > 1 && (
                <nav className={styles.pager} aria-label="Pages">
                    <button type="button" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>
                        Newer
                    </button>
                    <span>
                        Page {page} of {pages}
                    </span>
                    <button type="button" disabled={page >= pages} onClick={() => update({ page: page + 1 })}>
                        Older
                    </button>
                </nav>
            )}
        </section>
    );
}

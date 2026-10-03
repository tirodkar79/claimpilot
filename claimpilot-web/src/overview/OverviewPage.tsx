import styles from './OverviewPage.module.css';

/** Landing page until the claim screens ship. */
export function OverviewPage() {
    return (
        <section className={styles.hero}>
            <h2 className={styles.headline}>
                Evidence beats <em>assertion.</em>
            </h2>
            <p className={styles.lede}>
                Multi-agent triage for flight-delay claims. Agents gather and interpret evidence, a rules engine decides
                the payout, and anything uncertain goes to a human.
            </p>
        </section>
    );
}

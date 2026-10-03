import type { PolicyClause } from './policy.schema';

const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'was', 'what', 'how', 'does', 'this', 'that', 'with', 'any']);
const TITLE_WEIGHT = 3;

/**
 * Splits text into lower-case search terms (3+ letters, no stop words, naive plural stripping).
 * @param text Text to tokenise.
 */
function terms(text: string): string[] {
    return (text.toLowerCase().match(/[a-z]{3,}/g) ?? [])
        .filter((term) => !STOP_WORDS.has(term))
        .map((term) => (term.length > 4 && term.endsWith('s') ? term.slice(0, -1) : term));
}

/**
 * Keyword search over a policy's clauses: term matches in the title count three times as much as
 * matches in the text. Three short policies don't justify embeddings, and clause ids stay exact.
 * @param clauses Clauses of one policy.
 * @param query Free-text query, e.g. "weather exclusion".
 * @param limit Maximum clauses to return.
 * @returns Matching clauses, best first; empty when nothing matches.
 */
export function searchClauses(clauses: PolicyClause[], query: string, limit = 3): PolicyClause[] {
    const queryTerms = new Set(terms(query));
    if (!queryTerms.size) return [];

    return clauses
        .map((clause) => {
            const titleTerms = terms(clause.title);
            const textTerms = terms(clause.text);
            let score = 0;
            for (const term of queryTerms) {
                score += TITLE_WEIGHT * titleTerms.filter((t) => t === term).length;
                score += textTerms.filter((t) => t === term).length;
            }
            return { clause, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ clause }) => clause);
}

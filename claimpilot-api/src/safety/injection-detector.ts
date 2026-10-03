/** Instruction-like patterns that don't belong in a claimant's description of a delayed flight. */
const PATTERNS: { id: string; pattern: RegExp }[] = [
    {
        id: 'ignore_instructions',
        pattern: /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(instructions?|rules?|prompts?|guidelines?)\b/i,
    },
    { id: 'role_marker', pattern: /(^|\s)(system|assistant|developer)\s*:/i },
    { id: 'persona_change', pattern: /\b(you are now|you are no longer|act as|pretend to be)\b/i },
    {
        id: 'force_outcome',
        pattern: /\b(approve|accept|pay)\b[^.\n]{0,30}\b(maximum|max|full|highest|immediately|regardless)\b/i,
    },
    { id: 'set_field', pattern: /\bset\s+[\w.]+\s+(to|=)\s*\d+/i },
    { id: 'prompt_tags', pattern: /<\/?\s*(claim|system|instructions?)\s*>/i },
];

export interface InjectionScan {
    suspected: boolean;
    /** Ids of the patterns found, e.g. ["role_marker", "force_outcome"]. */
    signals: string[];
}

/**
 * Scans claimant text for instruction-like content. Detection is for visibility (trace, UI, review); safety
 * doesn't depend on it, because the raw text only ever reaches the tool-less Intake agent as fenced data.
 * @param text Raw claimant message.
 */
export function scanForInjection(text: string): InjectionScan {
    const signals = PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ id }) => id);
    return { suspected: signals.length > 0, signals };
}

/**
 * Neutralises tags that could close the `<claim>` fence around the claimant's text in the Intake prompt.
 * @param text Raw claimant message.
 */
export function defuseFence(text: string): string {
    return text.replace(/<\/?\s*claim\s*>/gi, '[tag removed]');
}

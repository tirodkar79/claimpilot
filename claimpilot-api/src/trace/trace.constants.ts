/** Who produced a trace event. Grows as sub-agents are added. */
export const TRACE_ACTORS = [
    'orchestrator',
    'intake',
    'policy',
    'flight',
    'weather',
    'integrity',
    'reviewer',
    'claimant',
] as const;
export type TraceActor = (typeof TRACE_ACTORS)[number];

export const TRACE_EVENT_TYPES = [
    'triage.started',
    'agent.started',
    'agent.completed',
    'agent.failed',
    /** The orchestrator handed work to a sub-agent. */
    'agent.delegated',
    /** An agent called one of its tools. */
    'tool.called',
    /** Code stepped in because an agent skipped a required step. */
    'guard.enforced',
    /** Deterministic checks (no model) finished. */
    'checks.completed',
    'decision',
    'triage.completed',
    /** A person decided a referred claim (after triage completed). */
    'review.decided',
    /** The claimant answered a NEED_INFO outcome; triage runs again. */
    'details.added',
] as const;
export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

/** The stream for a claim ends after this event. */
export const TERMINAL_TRACE_EVENT: TraceEventType = 'triage.completed';

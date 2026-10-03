/** Who produced a trace event. Grows as sub-agents are added. */
export const TRACE_ACTORS = ['orchestrator', 'intake'] as const;
export type TraceActor = (typeof TRACE_ACTORS)[number];

export const TRACE_EVENT_TYPES = [
    'triage.started',
    'agent.started',
    'agent.completed',
    'agent.failed',
    'decision',
    'triage.completed',
] as const;
export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

/** The stream for a claim ends after this event. */
export const TERMINAL_TRACE_EVENT: TraceEventType = 'triage.completed';

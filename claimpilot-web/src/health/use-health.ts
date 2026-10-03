import { useQuery } from '@tanstack/react-query';
import { getHealth } from '../api/health.api';

export const HEALTH_POLL_MS = 15_000;

/** Polls the API health endpoint. No retries: a failed check is itself the signal. */
export function useHealth() {
    return useQuery({
        queryKey: ['health'],
        queryFn: getHealth,
        refetchInterval: HEALTH_POLL_MS,
        retry: false,
    });
}

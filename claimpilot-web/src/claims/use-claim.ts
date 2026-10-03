import { useQuery } from '@tanstack/react-query';
import { getClaim } from './claims.api';

/**
 * Loads a claim. Refreshed by {@link useClaimEvents} when triage completes.
 * @param claimId Claim id.
 */
export function useClaim(claimId: string) {
    return useQuery({ queryKey: ['claim', claimId], queryFn: () => getClaim(claimId) });
}

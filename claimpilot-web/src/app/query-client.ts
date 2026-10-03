import { QueryClient } from '@tanstack/react-query';

/** Single query client for the app. One retry for reads; UI-level hooks can override. */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: 1, refetchOnWindowFocus: false },
    },
});

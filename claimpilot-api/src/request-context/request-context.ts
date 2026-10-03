import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '../auth/auth.constants';

export interface RequestContextStore {
    requestId: string;
    role?: Role;
}

/**
 * Per-request values (request id, caller role) readable anywhere in the call chain, including
 * code outside Nest's DI such as axios interceptors and agent tools.
 */
export class RequestContext {
    private static readonly storage = new AsyncLocalStorage<RequestContextStore>();

    /**
     * Runs `fn` with `store` as the current context, including everything it awaits.
     * @param store Values for this request.
     * @param fn Work to run inside the context.
     */
    static run<T>(store: RequestContextStore, fn: () => T): T {
        return this.storage.run(store, fn);
    }

    /** Current context, or undefined outside a request. */
    static get(): RequestContextStore | undefined {
        return this.storage.getStore();
    }

    /** Current request id, or undefined outside a request. */
    static requestId(): string | undefined {
        return this.storage.getStore()?.requestId;
    }

    /**
     * Records the authenticated caller's role; no-op outside a request.
     * @param role Role resolved by the auth guard.
     */
    static setRole(role: Role): void {
        const store = this.storage.getStore();
        if (store) store.role = role;
    }
}

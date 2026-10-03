import { useSyncExternalStore } from 'react';

export interface PersistedStore<T> {
    get(): T;
    set(value: T): void;
    subscribe(listener: () => void): () => void;
}

/**
 * Creates a tiny external store backed by localStorage. Readable outside React (e.g. axios
 * interceptors) and subscribable from components via {@link usePersistedStore}.
 * Storage failures (private mode, blocked site data) fall back to in-memory state.
 * @param key localStorage key.
 * @param isValid Guards against stale or tampered stored values.
 * @param fallback Value used when nothing valid is stored.
 * @param onChange Side effect run with the initial value and on every change.
 */
export function createPersistedStore<T extends string>(
    key: string,
    isValid: (value: string) => value is T,
    fallback: () => T,
    onChange?: (value: T) => void,
): PersistedStore<T> {
    const listeners = new Set<() => void>();
    let current = readStored(key, isValid) ?? fallback();
    onChange?.(current);

    return {
        get: () => current,
        set(value) {
            if (value === current) return;
            current = value;
            writeStored(key, value);
            onChange?.(value);
            listeners.forEach((listener) => listener());
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

/**
 * Subscribes a component to a persisted store.
 * @param store Store created with {@link createPersistedStore}.
 * @returns Current value and setter.
 */
export function usePersistedStore<T>(store: PersistedStore<T>): [T, (value: T) => void] {
    const value = useSyncExternalStore(store.subscribe, store.get);
    return [value, store.set];
}

/**
 * Reads a stored value if it passes validation.
 * @param key localStorage key.
 * @param isValid Value guard.
 */
function readStored<T extends string>(key: string, isValid: (value: string) => value is T): T | undefined {
    try {
        const stored = localStorage.getItem(key);
        return stored !== null && isValid(stored) ? stored : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Persists a value, ignoring storage failures.
 * @param key localStorage key.
 * @param value Value to store.
 */
function writeStored(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage unavailable: the value still lives in memory for this session.
    }
}

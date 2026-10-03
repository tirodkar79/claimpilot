import { createPersistedStore } from './persisted-store';

type Fruit = 'apple' | 'pear';

/**
 * Narrows a string to a test value.
 * @param value Stored value.
 */
const isFruit = (value: string): value is Fruit => value === 'apple' || value === 'pear';

describe('createPersistedStore', () => {
    it('uses the fallback when nothing is stored and runs onChange with it', () => {
        const onChange = vi.fn();
        const store = createPersistedStore('fruit', isFruit, () => 'apple', onChange);
        expect(store.get()).toBe('apple');
        expect(onChange).toHaveBeenCalledWith('apple');
    });

    it('restores a valid stored value and ignores an invalid one', () => {
        localStorage.setItem('fruit', 'pear');
        expect(createPersistedStore('fruit', isFruit, () => 'apple').get()).toBe('pear');

        localStorage.setItem('fruit', 'banana');
        expect(createPersistedStore('fruit', isFruit, () => 'apple').get()).toBe('apple');
    });

    it('persists, notifies subscribers and skips no-op sets', () => {
        const store = createPersistedStore('fruit', isFruit, () => 'apple');
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);

        store.set('pear');
        store.set('pear');
        expect(localStorage.getItem('fruit')).toBe('pear');
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        store.set('apple');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps working in memory when storage throws', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const store = createPersistedStore('fruit', isFruit, () => 'apple');
        store.set('pear');
        expect(store.get()).toBe('pear');
        vi.restoreAllMocks();
    });
});

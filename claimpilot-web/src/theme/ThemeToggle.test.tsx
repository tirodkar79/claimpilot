import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { themeStore } from './theme.store';
import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
    afterEach(() => themeStore.set('light'));

    it('applies and persists the chosen theme', async () => {
        themeStore.set('light');
        render(<ThemeToggle />);

        await userEvent.click(screen.getByRole('radio', { name: 'Dark theme' }));

        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(localStorage.getItem('claimpilot:theme')).toBe('dark');
        expect(screen.getByRole('radio', { name: 'Dark theme' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'Light theme' })).toHaveAttribute('aria-checked', 'false');
    });
});

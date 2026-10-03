import { Moon, Sun } from 'lucide-react';
import { usePersistedStore } from '../lib/persisted-store';
import { themeStore, type ThemeMode } from './theme.store';
import styles from './ThemeToggle.module.css';

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
    { mode: 'light', label: 'Light theme', Icon: Sun },
    { mode: 'dark', label: 'Dark theme', Icon: Moon },
];

/** Two-segment light/dark switch. The choice persists across visits. */
export function ThemeToggle() {
    const [theme, setTheme] = usePersistedStore(themeStore);

    return (
        <div className={styles.toggle} role="radiogroup" aria-label="Theme">
            {OPTIONS.map(({ mode, label, Icon }) => (
                <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={theme === mode}
                    aria-label={label}
                    className={styles.option}
                    onClick={() => setTheme(mode)}
                >
                    <Icon size={16} strokeWidth={1.8} />
                </button>
            ))}
        </div>
    );
}

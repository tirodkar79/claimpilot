import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react()],
    server: { port: 5173 },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        env: {
            VITE_API_URL: 'http://api.test',
            VITE_CLAIMANT_API_KEY: 'claimant-key',
            VITE_REVIEWER_API_KEY: 'reviewer-key',
        },
        css: { modules: { classNameStrategy: 'non-scoped' } },
    },
});

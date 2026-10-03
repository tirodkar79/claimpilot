import { Role } from '../auth/auth.constants';
import { validateEnv } from './env.validation';

const required = {
    MONGO_URI: 'mongodb://localhost:27017/claimpilot',
    API_KEYS: 'claimant:claimant-key, reviewer:reviewer-key',
};

describe('validateEnv', () => {
    it('parses API_KEYS into a key → role map and applies defaults', () => {
        const env = validateEnv(required);

        expect(env.API_KEYS.get('claimant-key')).toBe(Role.Claimant);
        expect(env.API_KEYS.get('reviewer-key')).toBe(Role.Reviewer);
        expect(env).toMatchObject({ PORT: 3000, HTTP_TIMEOUT_MS: 8000, HTTP_MAX_RETRIES: 2 });
        expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    });

    it('coerces numbers and splits CORS origins', () => {
        const env = validateEnv({ ...required, PORT: '4000', CORS_ORIGINS: 'http://a.test, http://b.test' });
        expect(env.PORT).toBe(4000);
        expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    });

    it.each([
        ['an unknown role', { API_KEYS: 'admin:key' }, /API_KEYS: Invalid entry "admin:key"/],
        ['a role without a key', { API_KEYS: 'claimant:' }, /API_KEYS: Invalid entry/],
        ['a non-mongo URI', { MONGO_URI: 'http://localhost' }, /MONGO_URI: must be a mongodb/],
        ['retries out of range', { HTTP_MAX_RETRIES: '9' }, /HTTP_MAX_RETRIES/],
    ])('rejects %s', (_label, override, message) => {
        expect(() => validateEnv({ ...required, ...override })).toThrow(message);
    });

    it('lists every missing variable at once', () => {
        expect(() => validateEnv({})).toThrow(/MONGO_URI[\s\S]*API_KEYS/);
    });
});

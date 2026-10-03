import axios from 'axios';
import { API_KEY_HEADER } from '../auth/auth.constants';
import { roleStore } from '../auth/role.store';
import { env } from '../config/env';
import { toApiError } from './api-error';

/** Shared client for the ClaimPilot API. Sends the active role's key; rejects with `ApiError`. */
export const httpClient = axios.create({ baseURL: env.apiUrl, timeout: 15_000 });

httpClient.interceptors.request.use((config) => {
    config.headers.set(API_KEY_HEADER, env.apiKeys[roleStore.get()]);
    return config;
});

httpClient.interceptors.response.use(undefined, (error: unknown) => Promise.reject(toApiError(error)));

import { httpClient } from './http-client';

export interface Health {
    status: 'ok';
    mongo: 'up';
    uptimeSeconds: number;
}

/** Fetches `GET /health`. Rejects with `ApiError` (503 when MongoDB is down). */
export async function getHealth(): Promise<Health> {
    const { data } = await httpClient.get<Health>('/health');
    return data;
}

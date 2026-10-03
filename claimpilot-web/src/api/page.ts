/** One page of a list endpoint. Mirrors Page in claimpilot-api/src/mongo/mongo.repository.ts. */
export interface Page<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
}

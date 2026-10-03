import { isValidObjectId, Model, QueryFilter, UpdateQuery } from 'mongoose';

export type SortOrder = Record<string, 1 | -1>;

export interface PageQuery<T> {
    filter?: QueryFilter<T>;
    page?: number;
    limit?: number;
    sort?: SortOrder;
}

export interface Page<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
}

const MAX_PAGE_LIMIT = 100;

/**
 * Base class for collection repositories. Returns plain (lean) objects, never Mongoose documents,
 * so services can't accidentally persist partial state. Malformed ids resolve to `null`
 * instead of throwing a CastError.
 */
export abstract class MongoRepository<T> {
    protected constructor(protected readonly model: Model<T>) {}

    /**
     * Finds a document by id.
     * @param id ObjectId as a string.
     * @returns The document, or null if not found or the id is malformed.
     */
    async findById(id: string): Promise<T | null> {
        if (!isValidObjectId(id)) return null;
        return this.model.findById(id).lean<T>().exec();
    }

    /**
     * Finds the first document matching a filter.
     * @param filter Mongo query filter.
     */
    findOne(filter: QueryFilter<T>): Promise<T | null> {
        return this.model.findOne(filter).lean<T>().exec();
    }

    /**
     * Finds all documents matching a filter. Use `paginate` for anything user-facing.
     * @param filter Mongo query filter (default: all).
     * @param sort Sort order (default: newest first).
     */
    find(filter: QueryFilter<T> = {}, sort: SortOrder = { _id: -1 }): Promise<T[]> {
        return this.model.find(filter).sort(sort).lean<T[]>().exec();
    }

    /**
     * Inserts a document after schema validation.
     * @param doc Fields of the new document.
     * @returns The stored document as a plain object.
     */
    async create(doc: Partial<T>): Promise<T> {
        const created = await this.model.create(doc);
        return created.toObject() as T;
    }

    /**
     * Applies an update and returns the new version. Schema validators run on the update.
     * @param id ObjectId as a string.
     * @param update Mongo update document.
     * @returns The updated document, or null if not found or the id is malformed.
     */
    async updateById(id: string, update: UpdateQuery<T>): Promise<T | null> {
        if (!isValidObjectId(id)) return null;
        return this.model
            .findByIdAndUpdate(id, update, { returnDocument: 'after', runValidators: true })
            .lean<T>()
            .exec();
    }

    /**
     * Returns one page of matching documents plus the total count.
     * `page` is clamped to ≥ 1 and `limit` to 1–100.
     * @param query Filter, page (1-based), limit and sort.
     */
    async paginate({ filter = {}, page = 1, limit = 20, sort = { _id: -1 } }: PageQuery<T> = {}): Promise<Page<T>> {
        const safePage = Math.max(1, Math.floor(page));
        const safeLimit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.floor(limit)));
        const [items, total] = await Promise.all([
            this.model
                .find(filter)
                .sort(sort)
                .skip((safePage - 1) * safeLimit)
                .limit(safeLimit)
                .lean<T[]>()
                .exec(),
            this.model.countDocuments(filter).exec(),
        ]);
        return { items, total, page: safePage, limit: safeLimit };
    }
}

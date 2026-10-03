import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Schema, Types } from 'mongoose';
import { MongoRepository } from './mongo.repository';

interface Widget {
    _id: Types.ObjectId;
    name: string;
    size: number;
}

/** Minimal concrete repository to exercise the base class. */
class WidgetRepository extends MongoRepository<Widget> {
    constructor(model: Model<Widget>) {
        super(model);
    }
}

let mongo: MongoMemoryServer;
let model: Model<Widget>;
let repository: WidgetRepository;

// The first run downloads the mongod binary, so allow a generous timeout.
beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    model = mongoose.model<Widget>('Widget', new Schema<Widget>({ name: String, size: { type: Number, min: 0 } }));
    repository = new WidgetRepository(model);
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
});

beforeEach(() => model.deleteMany({}));

describe('MongoRepository', () => {
    it('creates and reads back plain objects, not documents', async () => {
        const created = await repository.create({ name: 'a', size: 1 });
        const found = await repository.findById(String(created._id));

        expect(found).toMatchObject({ name: 'a', size: 1 });
        expect(created).not.toBeInstanceOf(mongoose.Document);
        expect(found).not.toBeInstanceOf(mongoose.Document);
    });

    it('returns null for malformed ids instead of throwing', async () => {
        await expect(repository.findById('not-an-id')).resolves.toBeNull();
        await expect(repository.updateById('not-an-id', { size: 2 })).resolves.toBeNull();
    });

    it('finds by filter with sort', async () => {
        await repository.create({ name: 'b', size: 2 });
        await repository.create({ name: 'a', size: 1 });

        await expect(repository.findOne({ name: 'b' })).resolves.toMatchObject({ size: 2 });
        const sorted = await repository.find({ size: { $gte: 1 } }, { size: 1 });
        expect(sorted.map((w) => w.name)).toEqual(['a', 'b']);
    });

    it('returns the updated document and runs schema validators', async () => {
        const { _id } = await repository.create({ name: 'a', size: 1 });

        await expect(repository.updateById(String(_id), { size: 5 })).resolves.toMatchObject({ size: 5 });
        await expect(repository.updateById(String(_id), { size: -1 })).rejects.toThrow(/size/);
    });

    it('paginates with totals and clamps page and limit', async () => {
        await model.insertMany(Array.from({ length: 25 }, (_, i) => ({ name: `w${i}`, size: i })));

        const second = await repository.paginate({ page: 2, limit: 10, sort: { size: 1 } });
        expect(second).toMatchObject({ total: 25, page: 2, limit: 10 });
        expect(second.items.map((w) => w.size)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

        const clamped = await repository.paginate({ page: 0, limit: 1000 });
        expect(clamped).toMatchObject({ page: 1, limit: 100 });
        expect(clamped.items).toHaveLength(25);
    });
});

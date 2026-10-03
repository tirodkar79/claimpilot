import { createSseParser } from './claim-events';

describe('createSseParser', () => {
    it('parses complete events and keeps partial ones until the rest arrives', () => {
        const parse = createSseParser<{ seq: number }>();

        expect(parse('data: {"seq":1}\n\ndata: {"se')).toEqual([{ seq: 1 }]);
        expect(parse('q":2}\n\n')).toEqual([{ seq: 2 }]);
    });

    it('ignores comments and non-data fields', () => {
        const parse = createSseParser<{ seq: number }>();
        expect(parse(': keep-alive\n\nid: 7\nevent: message\ndata: {"seq":3}\n\n')).toEqual([{ seq: 3 }]);
    });

    it('joins multi-line data fields', () => {
        const parse = createSseParser<{ a: number; b: number }>();
        expect(parse('data: {"a":1,\ndata: "b":2}\n\n')).toEqual([{ a: 1, b: 2 }]);
    });
});

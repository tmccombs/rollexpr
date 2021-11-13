import { expect } from 'chai';
import { parse, Expression, RollResult } from '../index.js';
import * as sinon from 'sinon';

afterEach(() => {
    sinon.restore();
});

function evalExpr(input: string): number {
    return parse(input).calc({});
}

function parsing(input: string): () => Expression {
    return () => parse(input);
}

function fakeRandom(...values: number[]): sinon.SinonSpy {
    const size = values.length;
    let i = 0;
    const fake = sinon.fake(() => {
        if (i < size) {
            return values[i++];
        } else {
            throw new Error(`fakeRandom called ${i + 1} times, but only expected ${i}`);
        }
    });
    sinon.replace(Math, 'random', fake);
    return fake;
}

describe('parse', () => {
    describe('numbers', () => {
        const tests: [string, number][] = [
            ['1', 1],
            ['  2', 2],
            ['45  ', 45],
            [' \t0   ', 0],
            ['1.3', 1.3],
            ['0.5', 0.5],
            ['34.2124', 34.2124],
        ];
        for (const [expr, expected] of tests) {
            it(`should parse "${expr}"`, () => {
                expect(evalExpr(expr)).to.be.approximately(expected, 0.001);
            });
        }
    });

    describe('variables', () => {
        const names: string[] = ['foo', 'foo.bar', 'foo_bar', '$expr', '$expr.FooBar_cat', '_123'];
        for (const name of names) {
            it(`should parse "${name}`, () => {
                expect(parsing(name)).not.to.throw();
            });
        }
    });

    describe('invalid', () => {
        const inputs = ['1foo', 'f;3d3', '1+*3', '+a', '1d43o'];
        for (const input of inputs) {
            it(`should fail to parse "${input}"`, () => {
                expect(parsing(input)).to.throw();
            });
        }
    });
});

describe('calculation', () => {
    it('should respect order of operations', () => {
        expect(evalExpr('1 + (3 - 2) * 4 - 2')).to.equal(1 + (3 - 2) * 4 - 2);
        expect(evalExpr('4 + 2 - 1')).to.equal(5);
        expect(evalExpr('2 + 3 * 4')).to.equal(14);
        expect(evalExpr('4 / 2 * 2 - 1')).to.equal(3);
    });

    it('should use variables from context', () => {
        expect(parse('a + b + 1').calc({ a: 2, b: 3 })).to.equal(6);
    });

    it('should roll dice', () => {
        const fakeRandom = sinon.fake.returns(0.19);
        sinon.replace(Math, 'random', fakeRandom);
        const expr = parse('1d20');
        expect(expr.calc({})).to.equal(4);
        sinon.assert.calledOnce(fakeRandom);
    });
});

describe('toString', () => {
    const inputs = [
        '2 * (3 + 4)',
        'a + 1d20h',
        'a + b - c',
        '3d20 - b + a.c',
        '1 * k + (j - 4.5) / 2',
        'a + (b - 2)',
        'a * (b / c)',
    ];

    for (const input of inputs) {
        it(`should produce the original input for "${input}"`, () => {
            expect(parse(input).toString()).to.equal(input);
        });
    }
});

describe('roll', () => {
    it(`should store rolls in rolls array`, () => {
        // Specify exact random values
        fakeRandom(0.797, 0.389, 0.666, 0.054, 0.806, 0.245, 0.002);
        const expr = parse('2d20h + 1d4 + 4d6');
        const rolls: RollResult[] = [];
        expect(expr.calc({}, rolls)).to.equal(28);
        expect(rolls).to.deep.equal([
            {
                die: 20,
                rolls: [16, 8],
                value: 16,
            },
            {
                die: 4,
                rolls: [3],
                value: 3,
            },
            {
                die: 6,
                rolls: [1, 5, 2, 1],
                value: 9,
            },
        ]);
    });
});

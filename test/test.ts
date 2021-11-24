import { expect } from 'chai';
import { parse, Expression, RollResult } from '../index.js';
import * as sinon from 'sinon';

afterEach(() => {
    sinon.restore();
});

function evalExpr(input: string): number {
    return parse(input).calc({});
}

function simplifyExpr(input: string): string {
    return parse(input).simplify().toString();
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
            ['-42', -42],
            ['-0.5', -0.5],
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

    it('should normalize whitespace', () => {
        expect(parse('    a    +\t34\n/2+1d20    ').toString()).to.equal('a + 34 / 2 + 1d20');
    });
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

    it('should keep highest with "h"', () => {
        fakeRandom(0.392, 0.084, 0.301, 0.526, 0.932, 0.102);
        expect(evalExpr('6d100h')).to.equal(94);
    });

    it('should keep lowest with "l"', () => {
        fakeRandom(0.392, 0.084, 0.301, 0.526, 0.932, 0.102);
        expect(evalExpr('6d100l')).to.equal(9);
    });

    it('should use sum with no modifier', () => {
        fakeRandom(0.4, 0.2, 0.9);
        expect(evalExpr('3d8')).to.equal(4 + 2 + 8);
    });

    it('should have 1 as a minimum roll value', () => {
        sinon.replace(Math, 'random', sinon.fake.returns(0));
        expect(evalExpr('1d2')).to.equal(1);
        expect(evalExpr('1d10000')).to.equal(1);
    });

    it('should use the number of sides as the maximum value', () => {
        sinon.replace(Math, 'random', sinon.fake.returns(1 - Number.EPSILON));
        for (const i of [2, 8, 4, 100, 1923, 9837234]) {
            expect(evalExpr(`1d${i}`), `1d${i}`).to.equal(i);
        }
    });
});

describe('simplify', () => {
    it('should substitute values from context', () => {
        expect(parse('a + b + c').simplify({ a: 1, b: 2 }).toString()).to.equal('3 + c');
    });

    it('should leave rolls and unspecified variables unchanged', () => {
        const expr = parse('1d20 + dex');
        expect(expr.simplify()).to.equal(expr);
    });

    it('should combine number literals from left', () => {
        expect(simplifyExpr('4 + 8')).to.equal('12');
        expect(simplifyExpr(' 1 + 3  + a')).to.equal('4 + a');
        expect(simplifyExpr('4 * 2 + a')).to.equal('8 + a');
        expect(simplifyExpr('4 - 1 + a')).to.equal('3 + a');
        expect(simplifyExpr('8/2*a')).to.equal('4 * a');
    });

    it('should combine adjacent literals correctly with different operators of same precedence', () => {
        expect(simplifyExpr('a + 5 - 2')).to.equal('a + 3');
        expect(simplifyExpr('a - 3 + 1')).to.equal('a - 2');
        expect(simplifyExpr('a * 4 / 2')).to.equal('a * 2');
        expect(simplifyExpr('a / 9 * 3')).to.equal('a / 3');

        expect(simplifyExpr('a + 3 - 4')).to.equal('a - 1');
        expect(simplifyExpr('a - 1 + 9')).to.equal('a + 8');
        expect(simplifyExpr('a * 3 / 6')).to.equal('a / 2');
        expect(simplifyExpr('a / 2 * 8')).to.equal('a * 4');
    });

    it('should combine adjacent literals correctly with the same operator', () => {
        expect(simplifyExpr('a + 5 + 2')).to.equal('a + 7');
        expect(simplifyExpr('a - 3 - 1')).to.equal('a - 4');
        expect(simplifyExpr('a * 4 * 2')).to.equal('a * 8');
        expect(simplifyExpr('a / 9 / 3')).to.equal('a / 27');
    });

    it('should cancel out opposites', () => {
        expect(simplifyExpr('a + 5 - 5')).to.equal('a');
        expect(simplifyExpr('a - 5 + 5')).to.equal('a');
        expect(simplifyExpr('a * 5 / 5')).to.equal('a');
        expect(simplifyExpr('a / 5 * 5')).to.equal('a');
    });

    it('should work with negative numbers', () => {
        expect(simplifyExpr('-3 + 3')).to.equal('0');
        expect(simplifyExpr('-4 / 2')).to.equal('-2');
        expect(simplifyExpr('a + -1 - 2')).to.equal('a - 3');
        expect(simplifyExpr('a * -1 / 3')).to.equal('a / -3');
        expect(simplifyExpr('a - -3 + -2')).to.equal('a + 1');
        expect(simplifyExpr('a * 1 / -3')).to.equal('a / -3');
        expect(simplifyExpr('a + -3')).to.equal('a - 3');
    });

    it('should combine adjacent literals in multiple locations', () => {
        expect(simplifyExpr('1 + 2 * 3 + a - 2 + 4 * 2 + 1d6 * 4 / 2')).to.equal(
            '7 + a + 6 + 1d6 * 2'
        );
    });

    it('should not combine adjacent literals if one binds more closely to a non-literal', () => {
        expect(simplifyExpr('2 + 3 * a')).to.equal('2 + 3 * a');
        expect(simplifyExpr('2 + 3 * 1d4')).to.equal('2 + 3 * 1d4');
        expect(simplifyExpr('a / 2 + 4 - 1')).to.equal('a / 2 + 3');
    });
});

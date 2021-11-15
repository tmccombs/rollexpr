/**
 * GRAMMAR
 * -------
 *
 * Tokens (regex):
 *
 * SYMBOL: [a-zA-Z_][a-zA-Z1-9_.]*
 * ROLL: \d+d\d+[hl]?
 * LITERAL: \d+(.\d+)?
 *
 * Rules:
 *
 * expr: term | expr "+" term | expr "-" term
 * term: factor | term "*" factor | term "/" factor
 * factor: SYMBOL | ROLL | LITERAL | "(" expr ")"
 *
 */

interface Context {
    [k: string]: number;
}
export interface RollResult {
    rolls: number[];
    die: number;
    value: number;
}
export interface Expression {
    calc(context: Context, rolls?: RollResult[]): number;
    simplify(context?: Context): Expression;
    toString(): string;
}

type Operator = '+' | '-' | '*' | '/';
type Punctuation = Operator | '(' | ')';

type DiceMod = 'h' | 'l';

const precedence = {
    '+': 0,
    '-': 0,
    '*': 1,
    '/': 1,
};

function doOp(op: Operator, left: number, right: number): number {
    switch (op) {
        case '+':
            return left + right;
        case '-':
            return left - right;
        case '*':
            return left * right;
        case '/':
            return left / right;
    }
}

class Operation implements Expression {
    constructor(
        public op: '+' | '-' | '*' | '/',
        public left: Expression,
        public right: Expression
    ) {}

    public calc(context: Context, rolls?: RollResult[]): number {
        return doOp(this.op, this.left.calc(context, rolls), this.right.calc(context, rolls));
    }

    public simplify(context: Context): Expression {
        const left = this.left.simplify(context);
        const right = this.right.simplify(context);
        // TODO: simplify zeros and ones (for multiply/divide)
        if (left instanceof Literal && right instanceof Literal) {
            return new Literal(doOp(this.op, left.valueOf(), right.valueOf()));
        } else if (
            right instanceof Literal &&
            left instanceof Operation &&
            precedence[left.op] === precedence[this.op] &&
            left.right instanceof Literal
        ) {
            return Operation.mergeLeft(
                left.op,
                left.right.valueOf(),
                this.op,
                right.valueOf(),
                left.left
            );
        } else if (left === this.left && right === this.right) {
            return this; // Nothing changed so return the same object
        } else {
            return new Operation(this.op, left, right);
        }
    }

    public toString(): string {
        let res: string;
        if (this.left instanceof Operation && precedence[this.op] > precedence[this.left.op]) {
            res = `(${this.left})`;
        } else {
            res = this.left.toString();
        }
        res += ` ${this.op} `;
        if (this.right instanceof Operation && precedence[this.op] >= precedence[this.right.op]) {
            res += `(${this.right})`;
        } else {
            res += this.right.toString();
        }
        return res;
    }

    static mergeLeft(
        leftOp: Operator,
        left: number,
        rightOp: Operator,
        right: number,
        farLeft: Expression
    ): Expression {
        if (leftOp === rightOp) {
            if (leftOp === '+' || leftOp == '-') {
                return new Operation(leftOp, farLeft, new Literal(left + right));
            } else {
                return new Operation(leftOp, farLeft, new Literal(left * right));
            }
        } else if (left === right) {
            // the values cancel out, so just return the far left side
            return farLeft;
        } else {
            let op: Operator, bigger: number, smaller: number;
            if (left > right) {
                op = leftOp;
                bigger = left;
                smaller = right;
            } else {
                op = rightOp;
                bigger = right;
                smaller = left;
            }
            if (op === '+' || op === '-') {
                return new Operation(op, farLeft, new Literal(bigger - smaller));
            } else {
                return new Operation(op, farLeft, new Literal(bigger / smaller));
            }
        }
    }
}
class Roll implements Expression {
    constructor(private dice: number, private sides: number, private mod?: DiceMod) {}

    public calc(_ctx: Context, rollResults?: RollResult[]): number {
        const rolls = [];
        for (let i = 0; i < this.dice; i++) {
            rolls.push(this.roll1());
        }

        let result: number;
        if (this.mod === 'h') {
            result = Math.max(...rolls);
        } else if (this.mod === 'l') {
            result = Math.min(...rolls);
        } else {
            result = rolls.reduce((a, b) => a + b, 0);
        }
        rollResults?.push({
            die: this.sides,
            rolls: rolls,
            value: result,
        });
        return result;
    }

    public simplify(): Expression {
        return this;
    }

    public toString(): string {
        return `${this.dice}d${this.sides}${this.mod ?? ''}`;
    }

    private roll1(): number {
        return 1 + Math.floor(Math.random() * this.sides);
    }
}

class Literal implements Expression {
    constructor(private val: number) {}

    public calc(): number {
        return this.val;
    }

    public simplify(): Expression {
        return this;
    }

    public valueOf(): number {
        return this.val;
    }

    public toString(): string {
        return this.val.toString();
    }
}

class Reference implements Expression {
    constructor(public ref: string) {}

    public calc(context: Context): number {
        return context[this.ref] ?? 0;
    }

    public simplify(context?: Context): Expression {
        const v = context?.[this.ref];
        if (typeof v === 'number') {
            return new Literal(v);
        } else {
            return this;
        }
    }

    public toString(): string {
        return this.ref;
    }
}

type Token = Reference | Literal | Roll | Punctuation;

function* tokenize(expr: string): Iterator<Token> {
    const tokenPattern =
        /\s*(?:(?<sym>[$a-zA-Z_][a-zA-Z-1-9_.]*)|(?<dice>\d+)d(?<sides>\d+)(?<mod>[hl])?|(?<lit>-?\d+(?:\.\d+)?)|(?<op>[*/()+-]))/y;
    const endIdx = expr.length;
    while (tokenPattern.lastIndex < endIdx) {
        const match = tokenPattern.exec(expr);
        if (!match || !match.groups) {
            throw new Error(`Unexpected input: ${expr.substring(tokenPattern.lastIndex)}`);
        }

        const groups = match.groups;
        if (groups.sym) {
            yield new Reference(groups.sym);
        } else if (groups.dice) {
            yield new Roll(Number(groups.dice), Number(groups.sides), groups.mod as DiceMod);
        } else if (groups.lit) {
            yield new Literal(Number(groups.lit));
        } else if (groups.op) {
            yield groups.op as Punctuation;
        }
    }
}

class Tokenizer implements Iterator<Token> {
    private tokenStream: Iterator<Token>;
    private _peek?: IteratorResult<Token>;

    constructor(input: string) {
        this.tokenStream = tokenize(input);
    }

    public peek(): Token | undefined {
        if (!this._peek) {
            this._peek = this.tokenStream.next();
        }
        return this._peek.value;
    }

    public next(): IteratorResult<Token> {
        if (this._peek) {
            const ret = this._peek;
            delete this._peek;
            return ret;
        }
        return this.tokenStream.next();
    }

    [Symbol.iterator]() {
        return this;
    }
}

export function parse(input: string): Expression {
    const tokens = new Tokenizer(input.trim());
    const expr = parseExpr(tokens);
    const { done, value: tok } = tokens.next();
    if (!done) {
        throw new Error(`Unexpected token: ${tok} after ${expr}`);
    }
    return expr;
}

function opParser(
    op1: Operator,
    op2: Operator,
    nextParser: (toks: Tokenizer) => Expression
): (toks: Tokenizer) => Expression {
    return (toks: Tokenizer) => {
        let left = nextParser(toks);
        let op = toks.peek();
        while (op == op1 || op == op2) {
            toks.next();
            const right = nextParser(toks);
            left = new Operation(op, left, right);
            op = toks.peek();
        }
        return left;
    };
}

function parseFactor(toks: Tokenizer): Expression {
    const { done, value: tok } = toks.next();
    if (done) {
        throw new Error('Incomplete expression');
    }
    if (typeof tok === 'string') {
        if (tok == '(') {
            const expr = parseExpr(toks);
            if (toks.next().value !== ')') {
                throw new Error('Unmatched parenthesis');
            }
            return expr;
        } else {
            throw new Error(`Unexpected operator "${tok}"`);
        }
    }
    return tok;
}

const parseTerm = opParser('*', '/', parseFactor);
const parseExpr = opParser('+', '-', parseTerm);

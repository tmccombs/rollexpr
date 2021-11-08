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
interface RollResult {
    rolls: number[];
    die: number;
}
interface Expression {
    calc(context: Context, rolls?: RollResult[]): number;
    simplify(context: Context): Expression;
    toString(): string;
}

type Operator = '+' | '-' | '*' | '/';
type Punctuation = Operator | '(' | ')';

type DiceMod = 'h' | 'l';

class Operation implements Expression {
    constructor(public op: '+' | '-' | '*' | '/', public left: Expression, public right: Expression) {}

    public calc(context: Context, rolls?: RollResult[]): number {
        return this.doOp(this.left.calc(context, rolls), this.right.calc(context, rolls));
    }

    public simplify(context: Context): Expression {
        const left = this.left.simplify(context);
        const right = this.right.simplify(context);
        if (left instanceof Literal && right instanceof Literal) {
            return new Literal(this.doOp(left.valueOf(), right.valueOf()));
        } else {
            return new Operation(this.op, left, right);
        }
    }

    public toString(): string {
        let res: string;
        if (
            (this.op == '*' || this.op == '/') &&
            this.left instanceof Operation &&
            (this.left.op === '+' || this.left.op === '-')
        ) {
            res = `(${this.left})`;
        } else {
            res = this.left.toString();
        }
        res += ` ${this.op} `;
        if (this.right instanceof Operation) {
            res += `(${this.right})`;
        } else {
            res += this.right.toString();
        }
        return res;
    }

    private doOp(left: number, right: number): number {
        switch (this.op) {
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
}
class Roll implements Expression {
    constructor(private dice: number, private sides: number, private mod?: DiceMod) {}

    public calc(_ctx: Context, rollResults: RollResult[]): number {
        const rolls = [];
        for (let i = 0; i < this.dice; i++) {
            rolls.push(this.roll1());
        }

        rollResults.push({
            die: this.sides,
            rolls: rolls,
        });
        if (this.mod === 'h') {
            return Math.max(...rolls);
        } else if (this.mod === 'l') {
            return Math.min(...rolls);
        } else {
            return rolls.reduce((a, b) => a + b, 0);
        }
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

    public simplify(context: Context): Expression {
        const v = context[this.ref];
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
        /\s*(?:(?<sym>[a-zA-Z_][a-zA-Z-1-9_.]*)|(?<dice>\d+)d(?<sides>\d+)(?<mod>[hl])?|(?<lit>-?\d+(?:.\d+)?)|(?<op>[*/()+-]))/y;
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
    const tokens = new Tokenizer(input);
    const expr = parseExpr(tokens);
    const { done, value: tok } = tokens.next();
    if (!done) {
        throw new Error(`Unexpected token: ${tok}`);
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
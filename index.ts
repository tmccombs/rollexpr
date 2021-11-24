/**
 * GRAMMAR
 * -------
 *
 * Tokens (regex):
 *
 * SYMBOL: [a-zA-Z_$][a-zA-Z1-9_$.]*
 * ROLL: \d+d\d+[hl]?
 * LITERAL: \d+(.\d+)?
 *
 * Rules:
 *
 * expr: term | expr "+" term | expr "-" term
 * term: factor | term "*" factor | term "/" factor
 * factor: SYMBOL | ROLL | LITERAL | "(" expr ")"
 *
 * @author Thayne McCombs
 * @module
 */

/**
 * Values to subsitute for variables in the expression.
 * @example
 * ```
 * const expr = parse("DEX + 2");
 * expr.calc({DEX: 15}); // returns 17
 * ```
 */
interface Context {
    [k: string]: number;
}

/**
 * Details about a specific dice roll.
 *
 * For example, if an expression includes a "2d20" roll,
 * then a `RollResult` returned by {@link Expression.calc} will contain
 * the individual die rolls, and the toal value of the 2d20 roll.
 */
export interface RollResult {
    /** The values of individual die rolls */
    rolls: number[];
    /** The number of sides on the die rolled */
    die: number;
    /** The final value of the roll, typically the sum of rolls, but could be the highest or lowest roll if a modifier was used */
    value: number;
}
/**
 * A parsed expression, that can be evaluated and printed.
 */
export interface Expression {
    /**
     * Fully evaluate the expression.
     *
     * Any roll expressions are rolled, and any variables are substituted, then arithmetic
     * is performed and the final result returned.
     *
     * @param context An object containing values to substitute for variables. Any variable that
     * isn't referenced in the context will be replaced with 0.
     * @param rolls If supplied, then any dice roll that is evaluated will push a {@link RollResult}
     * to the array containing the detailed results of the roll.
     * @returns result of evaluating the expression
     */
    calc(context: Context, rolls?: RollResult[]): number;
    /**
     * Try to simplify the expression by performing any arithmetic on values that
     * are known without rolling die or subsituting unknown variables.
     *
     * This returns a new expression, and doesn't modify the existing expression.
     *
     * @param context Values to substitute for variables before simplifying. In the resulting expression,
     * these variables will have been replaced by literal numbers.
     * @returns expression that has been simplified if possible. If no changes were made, will return the same object.
     */
    simplify(context?: Context): Expression;
    /**
     * Return a string representation of the expression.
     * This expression should be suitable to be parsed as an expression, and can be used as a
     * serialized value of the expression.
     */
    toString(): string;
}

type Operator = '+' | '-' | '*' | '/';
/**
 * Punctuation tokens, either an operator, or parenthesis
 */
type Punctuation = Operator | '(' | ')';

/**
 * Modifiers for dice rolls:
 *
 * h: Keep highest roll
 * l: Keep lowest roll
 */
type DiceMod = 'h' | 'l';

/** Mapping from operator to precedence */
const precedence = {
    '+': 0,
    '-': 0,
    '*': 1,
    '/': 1,
};

/**
 * Error due to invalid syntax while parsing an expression.
 */
export class SyntaxError extends Error {
    public name: 'RollExSyntaxError';

    constructor(message: string) {
        super(message);
        this.name = 'RollExSyntaxError';
    }
}

/**
 * Perform a binary arithmetic operation
 */
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

/** A binary arithmetic operation */
class Operation implements Expression {
    /**
     * @param op The operation to perform
     * @param left The left operand
     * @param right The right operand
     */
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
                left.left,
                left.op,
                left.right.valueOf(),
                this.op,
                right.valueOf()
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

    /**
     * Given an expression of the form: `expr1 op1 lit1 op2 lit2` try to simplify the expression
     * into a new expression of the form `expr1 op expr2`, where `expr2` is a combination of
     * `lit1` and `lit2`.
     * `op1` and `op2` must have the same precedence.
     *
     * @param farLeft The leftmost sub-expression. `expr` in the above expression
     * @param leftOp The left operator. `op1` in the above expression
     * @param left The value of the left literal. `lit1` in the above expression
     * @param rightOp The right operator. `op2` in the above expression
     * @param right The value of the right literal. `lit2` in the above expression
     */
    static mergeLeft(
        farLeft: Expression,
        leftOp: Operator,
        left: number,
        rightOp: Operator,
        right: number
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
            // We have two different operators. For + or -, we need the difference of the two
            // for * and / we need the quotient.
            //
            // We use the operator that comes before the larger of the two numbers,
            // and subtracte/divide the bigger number by the smaller number.
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

/** A roll of one or more dice of the same type, such as 3d6 for 3 six-sided dice */
class Roll implements Expression {
    /**
     * @param dice The number of dice to roll
     * @param sides The number of sides on the dice/die
     * @param mod Modifier on the dice roll. Can be "h" to keep the highest roll or "l"
     * to keep the lowest roll. For example 3d20h will roll three d20s but use only
     * the value of the highest die as the final result.
     */
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

/** A literal number */
class Literal implements Expression {
    /**
     * @param val The numeric value of the literal
     */
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

/** A reference to a variable */
class Reference implements Expression {
    /**
     * @param ref The name of the variable.
     * Can include letters, digits, underscores, "$", and periods, but can't
     * start with a digit or period.
     */
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

/**
 * Possible types of tokens
 */
type Token = Reference | Literal | Roll | Punctuation;

/**
 * Tokenize a string into tokens of an expression
 *
 * @throws {SyntaxError} if there is an invalid token
 */
function* tokenize(expr: string): Iterator<Token> {
    const tokenPattern =
        /\s*(?:(?<sym>[$a-zA-Z_][$a-zA-Z1-9_.]*)|(?<dice>\d+)d(?<sides>\d+)(?<mod>[hl])?|(?<lit>-?\d+(?:\.\d+)?)|(?<op>[*/()+-]))/y;
    const endIdx = expr.length;
    while (tokenPattern.lastIndex < endIdx) {
        const match = tokenPattern.exec(expr);
        if (!match || !match.groups) {
            throw new SyntaxError(`Unexpected input: ${expr.substring(tokenPattern.lastIndex)}`);
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
    #tokenStream: Iterator<Token>;
    #peek?: IteratorResult<Token>;

    /**
     * @param input The string to tokenize
     */
    constructor(input: string) {
        this.#tokenStream = tokenize(input);
    }

    public peek(): Token | undefined {
        if (!this.#peek) {
            this.#peek = this.#tokenStream.next();
        }
        return this.#peek.value;
    }

    public next(): IteratorResult<Token> {
        if (this.#peek) {
            const ret = this.#peek;
            this.#peek = undefined;
            return ret;
        }
        return this.#tokenStream.next();
    }

    [Symbol.iterator]() {
        return this;
    }
}

/**
 * Parse a `string` into an {@link Expression}.
 *
 * Take a string and parse it according to the syntax described above, producing an
 * {@link Expression}.
 *
 * @throws {SyntaxError} if the input string doesn't have valid syntax.
 */
export function parse(input: string): Expression {
    const tokens = new Tokenizer(input.trim());
    const expr = parseExpr(tokens);
    const { done, value: tok } = tokens.next();
    if (!done) {
        throw new SyntaxError(`Unexpected token: ${tok} after ${expr}`);
    }
    return expr;
}

/**
 * Helper function to create a function for the recursive descent parser for
 * binary operators of the same precedence.
 * @param op1 First operator to accept
 * @param op2 Second operator to accept
 * @param nextParser The parsing function to recurse to for sub-expressions
 */
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

/**
 * Parse a factor, that is a literal, variable, or roll
 */
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

/**
 * Parse additive operators
 */
const parseTerm = opParser('*', '/', parseFactor);
/**
 * Parse multiplicitive oeprators
 */
const parseExpr = opParser('+', '-', parseTerm);

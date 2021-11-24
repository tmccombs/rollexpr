RollExpr is a javascript/typescript library for parsing and evaluating expressions that can
include variables, and dice rolls, as are commonly used in roll playing games.

# Example expressions

- `1d20 + DEX + PROF`
- `3d8 + STR`
- `2d6 - 1d4 + 2`
- `3d8 / 2`


# Usage

```javascript
import {parse} from 'rollexpr';

const expr = parse('1d20 + DEX + 3');

const context = {DEX: 2};
console.log(expr.calc(context)); // Print random int in [1, 20] + 5
console.log(expr.toString()); // Print "1d20 + DEX + 3"
console.log(expr.simplify(context).toString()); // Print "1d20 + 5"
```

# Syntax

## Operators

`RollExpr` supports the following mathemtical operators, with the normal precedence:

- `+` and `-`
- `*` and `/`
- `(` and `)`

## Literals

`RollExpr` supports literal numbers, which may be integers or floating point. Floating
point numbers must be one or more digits followed by decimal, then one or more digits. Integers must
be just a sequence of digits. Numbers are always assumed to be decimal. Either can optionally be preceded by a `-` to make it negative.

The supported formats may be extended in the future.

## Variables

An expression can contain variables, which are a (ASCII) letter, underscore (`_`), or dollar sign (`$`)
followed by zero or more letters, underscores, dollar signs, digits, and periods (`.`).

These variables can be substituted with values at evaluation time, or 0 if not supplied.

## Die rolls

A die roll is represented by the number of rolls followed by a "d", then the number of sides on each
die, with an optional modifier suffix. For example `1d4` rolls a single four-sided die, `4d6` rolls
four six-sided dice, and `2d20h` rolls two 2-sided dice, and uses the value of the higher one.

The currently supported modifiers are `h` which uses the highest die roll, and `l` which uses
the lowest die roll. So `2d20h` would be a roll with advantage and `2d20l` would be a roll with
disadvantage in D&D.


## ABNF of expression syntax

This uses the ABNF specification as described in [RFC-5234](https://datatracker.ietf.org/doc/html/rfc5234).


```abnf
expr = term / expr "+" term / expr "-" term
term = factor / term "*" factor / term "/" factor
factor = symbol / roll / literal / "(" expr ")"
symbol = (ALPHA / "_" / "$" ) *(ALPHA / DIGIT / "_" / "$" / ".")
literal = [ "-" ] 1*DIGIT [ "." 1*DIGIT ]
roll = 1*DIGIT "d" 1*DIGIT [ roll_modifier ]
roll_modifier = "h" / "l"
```

class InputStream {
    constructor(input) {
        this.pos = 0;
        this.input = input;
    }
    next() {
        return this.input.charAt(this.pos++);
    }
    peek() {
        return this.input.charAt(this.pos);
    }
    eof() {
        return this.peek() == '';
    }
    throw(msg) {
        throw new Error(msg + ' (' + this.pos + ')');
    }
}


class TokenStream {

    constructor(input) {
        this.current = null;
        this.input = typeof input == 'string' ? new InputStream(input) : input;
    }
    is_ch_whitespace(ch) {
        return ch == ' ';
    }
    is_ch_term(ch) {
        return /[a-z0-9]/i.test(ch);
    }
    is_ch_op(ch) {
        return "&|".indexOf(ch) >= 0;
    }
    is_ch_punc(ch) {
        return "()".indexOf(ch) >= 0;
    }
    read_string() {
        return {
            type: 'term',
            value: this.read_escaped('"')
        };
    }
    read_term() {
        return {
            type: 'term',
            value: this.read_while(this.is_ch_term)
        };
    }
    read_escaped(end) {
        var escaped = false, 
            str = "",
            ch;
        
        // Next
        this.input.next();

        // While
        while (!this.input.eof()) {

            // Next
            ch = this.input.next();

            // Escaped
            if (escaped) {
                str += ch;
                escaped = false;
            } 
            
            // Escape
            else if (ch == "\\") {
                escaped = true;
            } 
            
            // End
            else if (ch == end) {
                break;
            } 
            
            // String
            else {
                str += ch;
            }
        }

        // Return
        return str;
    }
    read_while(predicate) {
        var str = '';
        while (!this.input.eof() && predicate(this.input.peek())) {
            str += this.input.next();
        }
        return str;
    }
    read_next() {
        var ch;

        // Read whitespaces
        this.read_while(this.is_ch_whitespace);

        // EOF
        if (this.input.eof()) {
            return null;
        }

        // Peek the current
        ch = this.input.peek();

        // String
        if (ch == '"') {
            return this.read_string();
        }

        // Not
        if (ch == "!") {
            return {
                type: this.input.next()
            };
        }

        // Term
        if (this.is_ch_term(ch)) {
            return this.read_term();
        }

        // Operator
        if (this.is_ch_op(ch)) {
            return {
                type: this.input.next()
            };
        }

        // Punctuation
        if (this.is_ch_punc(ch)) {
            return {
                type: "punc",
                value: this.input.next()
            };
        }

        // Error
        this.throw('Unexpected character: ' + ch);
    }
    peek() {
        return this.current || (this.current = this.read_next());
    }
    next() {
        var tok = this.current;
        this.current = null;
        return tok || this.read_next();
    }
    eof() {
        return this.peek() == null;
    }
    throw(msg) {
        return this.input.throw(msg);
    }
}


class Parser {

    _precedence = {
        '|': 1,
        '&': 2
    }

    constructor(input) {
        this.input = typeof input == 'string' ? new TokenStream(input) : input;
    }

    unexpected() {
        this.input.throw("Unexpected token: " + JSON.stringify(this.input.peek()));
    }
    
    is_punc(ch) {
        var tok = this.input.peek();
        return tok && tok.type == "punc" && (!ch || tok.value == ch) && tok;
    }

    is_op() {
        var tok = this.input.peek();
        return tok && (tok.type == "&" || tok.type == '|') && tok;
    }

    is_not() {
        var tok = this.input.peek();
        return tok && tok.type == "!" && tok;
    }

    is_term() {
        var tok = this.input.peek();
        return tok && tok.type == "term" && tok;
    }

    skip_punc(ch) {
        if (this.is_punc(ch)) this.input.next();
        else this.input.throw("Expecting punctuation: \"" + ch + "\"");
    }

    parse_operands() {
        var operands;
        this.skip_punc('(');
        operands = this.parse_operand(true);
        this.skip_punc(')');
        return operands;
    }

    parse_operand(parse_op) {
        if (parse_op !== false) {
            return this.parse_operator(this.parse_operand(false), 0);
        }
        return this.lazy_operator(function() {
            if (this.is_not('!')) {
                return this.parse_not();
            }
            if (this.is_punc('(')) {
                return this.parse_operands();
            }
            if (this.is_term()) {
                return this.parse_term();
            }
            this.unexpected();
        });
    }
    
    lazy_operator(expr) {
        expr = expr.call(this);
        if (this.input.eof() || this.is_op() || this.is_punc(')')) {
            return expr;
        }
        if (this.is_lazy == false) {
            this.throw_lazy();
        } else {
            this.is_lazy = true;
        }
        return new Op('|', expr, this.parse_operand(true));
    }

    parse_operator(left, prec) {
        var tok,
            tok = this.is_op();

        if (tok) {
            if (this.is_lazy == true) {
                this.throw_lazy();
            } else {
                this.is_lazy = false;
            }
            var next = this._precedence[tok.type];
            if (next > prec) {
                this.input.next();
                return this.parse_operator(new Op(
                    tok.type, 
                    left, 
                    this.parse_operator(this.parse_operand(false), next)
                ), prec);
            }
        }

        return left;
    }

    parse_not() {
        this.input.next();
        return new Not(this.parse_operand(false));
    }

    parse_term() {
        return new Term(this.input.next().value);
    }

    throw_lazy() {
        return this.input.throw('Cannot mix lazy and non lazy operator');
    }
}

class Term {

    constructor(value) {
        this.type = 'term';
        this.value = value;
        this.tolerance = Math.ceil(value.length / 4);
    }

    exec(str, context) {
        var gap = 0,
            match = false,
            value = this.value;

        while (gap <= this.tolerance && !match) {
            value = this.value.substring(0, this.value.length - gap++);
            match = this.match(str, value, context);
        }

        return match;
    }

    match(str, value, context) {
        var index = str.indexOf(value);
        if (index == -1) {
            return false;
        }
        context.get('term')[index] = {
            length: value.length,
            gap: this.value.length - value.length
        };
        return true;
    }
}

class Not {

    constructor(value) {
        this.type = '!';
        this.value = value;
    }

    exec(str, context) {
        return !this.value.exec(str, context);
    }
}

class Op {

    constructor(type, left, right) {
        this.type = type;
        this.left = left;
        this.right = right;
    }

    exec(str, context) {
        var left = this.left.exec(str, context),
            right = this.right.exec(str, context);

        return this.type == '&' ? left && right : left || right;
    }
}

class Interpreter {
    
    constructor(input) {
        this.input = typeof input == 'string' ? new Parser(input) : input;
    }

    compile() {
        var compile = this.value || (this.value = this.input.parse_operand(true));
        console.log(JSON.stringify(compile));
        return compile;
    }

    exec(str) {
        var context = new Context(),
            success = this.compile().exec(str, context);

        context.success = success;

        return context;
    }
}

class Context {
    get(key) {
        if (!this[key]) {
            this[key] = {};
        }
        return this[key];
    }
}

try {
    var context = {},
        result = (new Interpreter('!abc | "defg ghij"')).exec('mystring abc defg ghi jkl');

    // Return
    console.log(JSON.stringify(result));
}
catch (e) {
    console.error(e);
}

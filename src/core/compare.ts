export interface CompareOptions {
    /** Code answers keep case and line structure; prose answers are compared loosely. */
    code: boolean;
    ignoreCase: boolean;
    lenientCodeWhitespace: boolean;
}

/** Reduce an answer to the form in which typed and expected text are compared. */
export function normalize(text: string, options: CompareOptions): string {
    let s = text.replace(/\r\n?/g, "\n").replace(/ /g, " ").normalize("NFC");
    if (options.code) {
        // Trailing whitespace and surrounding blank lines never matter; indentation does.
        const lines = s.split("\n").map((l) => l.replace(/\s+$/, ""));
        while (lines.length && lines[0] === "") lines.shift();
        while (lines.length && lines[lines.length - 1] === "") lines.pop();
        // The first line of a cloze starts mid-line, so its leading whitespace is not indentation.
        if (lines.length) lines[0] = lines[0].replace(/^\s+/, "");
        s = lines.join("\n");
        if (options.lenientCodeWhitespace) s = s.replace(/\s+/g, " ").trim();
        return s;
    }
    s = s.replace(/\s+/g, " ").trim();
    return options.ignoreCase ? s.toLowerCase() : s;
}

export function isCorrect(typed: string, expected: string, options: CompareOptions): boolean {
    return normalize(typed, options) === normalize(expected, options);
}

export interface DiffPart {
    /** "eq": in both. "del": typed but wrong. "ins": expected but missing. */
    op: "eq" | "del" | "ins";
    text: string;
}

/** Character diff from `typed` to `expected` (longest common subsequence). */
export function diffChars(typed: string, expected: string): DiffPart[] {
    const a = [...typed];
    const b = [...expected];
    const n = a.length;
    const m = b.length;
    if (n === 0 || m === 0 || n * m > 4_000_000) {
        return [
            ...(n ? [{ op: "del" as const, text: typed }] : []),
            ...(m ? [{ op: "ins" as const, text: expected }] : []),
        ];
    }

    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i * width + j] =
                a[i] === b[j]
                    ? lcs[(i + 1) * width + j + 1] + 1
                    : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
        }
    }

    const parts: DiffPart[] = [];
    const push = (op: DiffPart["op"], ch: string) => {
        const last = parts[parts.length - 1];
        if (last && last.op === op) last.text += ch;
        else parts.push({ op, text: ch });
    };
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            push("eq", a[i]);
            i++;
            j++;
        } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
            push("del", a[i++]);
        } else {
            push("ins", b[j++]);
        }
    }
    while (i < n) push("del", a[i++]);
    while (j < m) push("ins", b[j++]);
    return parts;
}

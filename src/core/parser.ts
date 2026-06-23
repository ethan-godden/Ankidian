import type { CardSource, ClozeSpan, FenceSegment, Segment } from "./types";

export interface ParseOptions {
    highlightClozes: boolean;
}

const ID_AT_END = /(^|\s)\^(ak-[a-z0-9]{4,})\s*$/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/;
const CLOZE_OPEN = /\{\{c(\d+)::/y;

/** Split a trailing `^ak-…` block ID off a line. */
export function splitId(line: string): { text: string; id: string | null } {
    const m = ID_AT_END.exec(line);
    if (!m) return { text: line, id: null };
    return { text: line.slice(0, m.index).trimEnd(), id: m[2] };
}

function isBlank(line: string): boolean {
    return line.trim().length === 0;
}

/** If `line` opens a fence, returns the index of the line that closes it (or the last line). */
function fenceEnd(lines: string[], i: number): number | null {
    const m = FENCE_OPEN.exec(lines[i]);
    if (!m) return null;
    const ch = m[1][0];
    const close = new RegExp(`^\\s*${ch === "`" ? "`" : "~"}{${m[1].length},}\\s*$`);
    for (let j = i + 1; j < lines.length; j++) {
        if (close.test(lines[j])) return j;
    }
    return lines.length - 1;
}

/** Parse every card source in a note. */
export function parseNote(text: string, options: ParseOptions): CardSource[] {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const sources: CardSource[] = [];
    const headings: { level: number; text: string }[] = [];
    let i = 0;

    // Frontmatter
    if (lines[0]?.trim() === "---") {
        const end = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
        if (end > 0) i = end + 1;
    }

    while (i < lines.length) {
        const line = lines[i];
        if (isBlank(line)) {
            i++;
            continue;
        }
        const h = HEADING.exec(line);
        if (h) {
            while (headings.length && headings[headings.length - 1].level >= h[1].length) {
                headings.pop();
            }
            headings.push({ level: h[1].length, text: h[2] });
            i++;
            continue;
        }

        // Collect a block: a run of non-blank lines, with fenced code kept whole.
        const start = i;
        const fenced = new Set<number>();
        while (i < lines.length) {
            const fe = fenceEnd(lines, i);
            if (fe !== null) {
                for (let k = i; k <= fe; k++) fenced.add(k);
                i = fe + 1;
                continue;
            }
            if (isBlank(lines[i]) || (i > start && HEADING.test(lines[i]))) break;
            i++;
        }
        const end = i - 1;

        const first = lines[start].trimStart();
        if (first.startsWith("%%") || first.startsWith("<!--")) continue;

        // A lone `^ak-id` line belongs to the block above it (how block IDs follow code blocks).
        if (start === end && !fenced.has(start)) {
            const lone = splitId(lines[start]);
            const prev = sources[sources.length - 1];
            if (lone.id && lone.text === "") {
                if (prev && prev.id === null && start - prev.lineEnd <= 2) {
                    prev.id = lone.id;
                    prev.lineEnd = start;
                }
                continue;
            }
        }

        const crumbs = headings.map((x) => x.text);
        sources.push(...parseBlock(lines, start, end, fenced, crumbs, options));
    }
    return sources;
}

function emptySource(
    kind: CardSource["kind"],
    lineStart: number,
    lineEnd: number,
    headings: string[],
): CardSource {
    return {
        kind,
        id: null,
        lineStart,
        lineEnd,
        body: "",
        headings,
        subs: [],
        segments: [],
        clozes: [],
        front: "",
        back: "",
    };
}

function parseBlock(
    lines: string[],
    start: number,
    end: number,
    fenced: Set<number>,
    headings: string[],
    options: ParseOptions,
): CardSource[] {
    // Block-level ID lives at the end of the last line (never on a fence line).
    const blockLines = lines.slice(start, end + 1);
    let id: string | null = null;
    if (!fenced.has(end)) {
        const last = splitId(blockLines[blockLines.length - 1]);
        if (last.id) {
            id = last.id;
            if (last.text === "") blockLines.pop();
            else blockLines[blockLines.length - 1] = last.text;
        }
    }
    const isFenced = (k: number) => fenced.has(start + k);

    // 1. Multi-line basic card: a line holding only "?" or "??".
    const sep = blockLines.findIndex(
        (l, k) => !isFenced(k) && (l.trim() === "?" || l.trim() === "??"),
    );
    if (sep > 0 && sep < blockLines.length - 1) {
        const src = emptySource("basic", start, end, headings);
        src.id = id;
        src.body = blockLines.join("\n");
        src.front = blockLines.slice(0, sep).join("\n");
        src.back = blockLines.slice(sep + 1).join("\n");
        src.subs = blockLines[sep].trim() === "??" ? ["f", "r"] : ["f"];
        return [src];
    }

    // 2. Cloze card: the whole block is the card.
    const body = blockLines.join("\n");
    const scanned = scanBody(body, options);
    if (scanned.clozes.length > 0) {
        const src = emptySource("cloze", start, end, headings);
        src.id = id;
        src.body = body;
        src.segments = scanned.segments;
        src.clozes = scanned.clozes;
        src.subs = clozeGroups(scanned.clozes);
        return [src];
    }

    // 3. Single-line basic cards: every `front::back` line is its own card with its own ID.
    const out: CardSource[] = [];
    for (let k = start; k <= end; k++) {
        if (fenced.has(k)) continue;
        const { text, id: lineId } = splitId(lines[k]);
        const found = findSeparator(text);
        if (!found) continue;
        const front = text.slice(0, found.index).replace(LIST_MARKER, "").trim();
        const back = text.slice(found.index + found.length).trim();
        if (!front || !back) continue;
        const src = emptySource("basic", k, k, headings);
        src.id = lineId;
        src.body = text;
        src.front = front;
        src.back = back;
        src.subs = found.length === 3 ? ["f", "r"] : ["f"];
        out.push(src);
    }
    return out;
}

/** Find the first `::` / `:::` that is not inside inline code. */
function findSeparator(line: string): { index: number; length: number } | null {
    let i = 0;
    while (i < line.length) {
        if (line[i] === "`") {
            const close = closeOfCodeSpan(line, i, line.length);
            if (close !== null) {
                i = close;
                continue;
            }
        }
        if (line.startsWith("::", i)) {
            return { index: i, length: line[i + 2] === ":" ? 3 : 2 };
        }
        i++;
    }
    return null;
}

/** If a backtick run at `i` opens an inline code span, return the index just past its close. */
function closeOfCodeSpan(text: string, i: number, limit: number): number | null {
    let n = 0;
    while (text[i + n] === "`") n++;
    let j = i + n;
    while (j < limit) {
        if (text[j] === "`") {
            let m = 0;
            while (text[j + m] === "`") m++;
            if (m === n) return j + m;
            j += m;
        } else {
            j++;
        }
    }
    return null;
}

function clozeGroups(clozes: ClozeSpan[]): string[] {
    const groups = [...new Set(clozes.map((c) => c.group))];
    const rank = (g: string) => (g[0] === "c" ? 0 : 1e6) + Number(g.slice(1));
    return groups.sort((a, b) => rank(a) - rank(b));
}

/** Split a card body into prose and fenced-code segments and find its cloze deletions. */
export function scanBody(
    body: string,
    options: ParseOptions,
): { segments: Segment[]; clozes: ClozeSpan[] } {
    const lines = body.split("\n");
    const offsets: number[] = [];
    let off = 0;
    for (const l of lines) {
        offsets.push(off);
        off += l.length + 1;
    }
    const lineEnd = (k: number) => offsets[k] + lines[k].length;

    const segments: Segment[] = [];
    let proseStart: number | null = null;
    const flushProse = (k: number) => {
        if (proseStart !== null) {
            segments.push({ type: "prose", start: offsets[proseStart], end: lineEnd(k) });
            proseStart = null;
        }
    };
    for (let k = 0; k < lines.length; k++) {
        const fe = fenceEnd(lines, k);
        if (fe === null) {
            proseStart ??= k;
            continue;
        }
        flushProse(k - 1);
        const closed = fe > k && /^\s*(`{3,}|~{3,})\s*$/.test(lines[fe]);
        const lastCode = closed ? fe - 1 : fe;
        const seg: FenceSegment = {
            type: "fence",
            start: offsets[k],
            end: lineEnd(fe),
            lang: (FENCE_OPEN.exec(lines[k])?.[2] ?? "").toLowerCase(),
            codeStart: Math.min(lineEnd(k) + 1, body.length),
            codeEnd: lastCode > k ? lineEnd(lastCode) : Math.min(lineEnd(k) + 1, body.length),
        };
        segments.push(seg);
        k = fe;
    }
    flushProse(lines.length - 1);

    const clozes: ClozeSpan[] = [];
    let highlights = 0;
    for (const seg of segments) {
        if (seg.type === "fence") {
            let i = seg.codeStart;
            while (i < seg.codeEnd) {
                const c = readCloze(body, i, seg.codeEnd, false);
                if (c) {
                    clozes.push(c);
                    i = c.end;
                } else i++;
            }
            continue;
        }
        let i = seg.start;
        let codeUntil = -1;
        while (i < seg.end) {
            const ch = body[i];
            if (ch === "{") {
                const c = readCloze(body, i, seg.end, true);
                if (c) {
                    clozes.push(c);
                    i = c.end;
                    continue;
                }
            } else if (ch === "`" && i >= codeUntil) {
                const close = closeOfCodeSpan(body, i, seg.end);
                if (close !== null) codeUntil = close;
                while (body[i] === "`") i++;
                continue;
            } else if (ch === "=" && options.highlightClozes && i >= codeUntil) {
                const c = readHighlight(body, i, seg.end);
                if (c) {
                    c.group = `h${++highlights}`;
                    clozes.push(c);
                    i = c.end;
                    continue;
                }
            }
            i++;
        }
    }
    return { segments, clozes };
}

/**
 * Read `{{cN::answer}}` (prose: `{{cN::answer::hint}}`) starting at `i`.
 *
 * Answers are often code, so the closing `}}` is found brace-aware:
 * `{{c1::x = {"a": {1}}}}` closes at the last two braces.
 */
function readCloze(body: string, i: number, limit: number, allowHint: boolean): ClozeSpan | null {
    CLOZE_OPEN.lastIndex = i;
    const m = CLOZE_OPEN.exec(body);
    if (!m) return null;
    const contentStart = i + m[0].length;

    let close = -1;
    let depth = 0;
    for (let k = contentStart; k < limit; k++) {
        const ch = body[k];
        if (depth === 0 && ch === "}" && body[k + 1] === "}") {
            close = k;
            break;
        }
        if (ch === "{") {
            if (body.startsWith("{{c", k) && /^\{\{c\d+::/.test(body.slice(k, k + 12))) break;
            depth++;
        } else if (ch === "}" && depth > 0) depth--;
    }
    // Unbalanced braces in the answer (e.g. a lone "{"): fall back to the first "}}".
    if (close < 0) {
        close = body.indexOf("}}", contentStart);
        if (close < 0 || close >= limit) return null;
    }

    let answer = body.slice(contentStart, close);
    let hint: string | undefined;
    if (allowHint) {
        const at = lastHintSeparator(answer);
        if (at >= 0) {
            hint = answer.slice(at + 2).trim() || undefined;
            answer = answer.slice(0, at);
        }
    }
    if (answer.trim() === "") return null;
    return { group: `c${Number(m[1])}`, start: i, end: close + 2, answer, hint };
}

/** Index of the last `::` outside inline code, or -1. */
function lastHintSeparator(text: string): number {
    let found = -1;
    let i = 0;
    while (i < text.length) {
        if (text[i] === "`") {
            const close = closeOfCodeSpan(text, i, text.length);
            if (close !== null) {
                i = close;
                continue;
            }
        }
        if (text.startsWith("::", i)) {
            found = i;
            i += 2;
            continue;
        }
        i++;
    }
    return found;
}

/** Read `==answer==` on a single line. */
function readHighlight(body: string, i: number, limit: number): ClozeSpan | null {
    if (!body.startsWith("==", i)) return null;
    const first = body[i + 2];
    if (first === undefined || first === "=" || /\s/.test(first)) return null;
    let lineLimit = body.indexOf("\n", i);
    if (lineLimit < 0 || lineLimit > limit) lineLimit = limit;
    const close = body.indexOf("==", i + 3);
    if (close < 0 || close >= lineLimit) return null;
    const answer = body.slice(i + 2, close);
    if (/\s$/.test(answer) || answer.includes("{{c")) return null;
    return { group: "", start: i, end: close + 2, answer };
}

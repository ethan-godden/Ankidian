import { walkText } from "./dom";

interface PrismToken {
    type: string;
    content: string | PrismToken | (string | PrismToken)[];
    alias?: string | string[];
}

/** The part of Prism that Ankidian uses. Obsidian provides it through `loadPrism()`. */
export interface PrismLike {
    languages: Record<string, unknown>;
    tokenize(text: string, grammar: unknown): (string | PrismToken)[];
}

/** Prism token types, folded into the colour groups Obsidian themes define (`--code-*`). */
const GROUPS: Record<string, string> = {
    comment: "comment", prolog: "comment", doctype: "comment", cdata: "comment",
    punctuation: "punctuation",
    tag: "tag", constant: "tag", symbol: "tag", deleted: "tag",
    boolean: "value", number: "value",
    "attr-name": "string", string: "string", char: "string", builtin: "string", inserted: "string",
    "template-string": "string", "triple-quoted-string": "string",
    operator: "operator", entity: "operator", url: "operator",
    atrule: "keyword", "attr-value": "keyword", keyword: "keyword",
    function: "function", "class-name": "function",
    regex: "important", important: "important", variable: "important",
    property: "property",
};

export const HIGHLIGHT_GROUPS = [...new Set(Object.values(GROUPS))];

interface Span {
    start: number;
    end: number;
    group: string;
}

/** Flatten Prism's nested token stream into coloured character spans. */
export function tokenSpans(tokens: (string | PrismToken)[]): Span[] {
    const spans: Span[] = [];
    let offset = 0;
    const visit = (token: string | PrismToken, inherited: string | null) => {
        if (typeof token === "string") {
            if (inherited) spans.push({ start: offset, end: offset + token.length, group: inherited });
            offset += token.length;
            return;
        }
        const alias = Array.isArray(token.alias) ? token.alias[0] : token.alias;
        const group = GROUPS[token.type] ?? (alias ? GROUPS[alias] : undefined) ?? inherited;
        const content = Array.isArray(token.content) ? token.content : [token.content];
        for (const child of content) visit(child, group);
    };
    for (const t of tokens) visit(t, null);
    return spans;
}

/** Build the same `<span class="token …">` tree Prism's HTML output would, without innerHTML. */
export function tokensToDom(doc: Document, tokens: (string | PrismToken)[]): DocumentFragment {
    const fragment = doc.createDocumentFragment();
    const visit = (token: string | PrismToken, parent: Node) => {
        if (typeof token === "string") {
            parent.appendChild(doc.createTextNode(token));
            return;
        }
        const span = doc.createElement("span");
        const alias = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
        span.className = ["token", token.type, ...alias].join(" ");
        const content = Array.isArray(token.content) ? token.content : [token.content];
        for (const child of content) visit(child, span);
        parent.appendChild(span);
    };
    for (const t of tokens) visit(t, fragment);
    return fragment;
}

interface HighlightRegistryWindow {
    CSS?: { highlights?: Map<string, unknown> };
    Highlight?: new (...ranges: Range[]) => unknown;
}

/**
 * Syntax-colours what the user types into blanks inside a code block, as they type.
 *
 * It uses the CSS Custom Highlight API: ranges are painted without touching the DOM, so the
 * editable text stays a plain text node and the caret, IME and native undo keep working.
 * The whole block (static code + everything typed so far) is tokenised, so a typed `return`
 * or a half-finished string is coloured in the context of the surrounding code.
 */
export class LiveHighlighter {
    private blocks: { code: HTMLElement; grammar: unknown }[] = [];
    private readonly win: HighlightRegistryWindow | null;

    constructor(
        doc: Document,
        private readonly prism: PrismLike,
    ) {
        const win = doc.defaultView as unknown as HighlightRegistryWindow | null;
        this.win = win?.CSS?.highlights && win.Highlight ? win : null;
    }

    get supported(): boolean {
        return this.win !== null;
    }

    add(code: HTMLElement, grammar: unknown): void {
        this.blocks.push({ code, grammar });
    }

    update(): void {
        if (!this.win) return;
        const ranges = new Map<string, Range[]>();
        for (const { code, grammar } of this.blocks) {
            // Text nodes that belong to a blank, with their offset in the block's full text.
            const typed: { node: Text; offset: number; length: number }[] = [];
            let full = "";
            walkText(code, (node, offset, length) => {
                full += node ? node.data : "\n";
                if (node && node.parentElement?.closest(".ak-input")) {
                    typed.push({ node, offset, length });
                }
            });
            if (typed.length === 0) continue;

            const spans = tokenSpans(this.prism.tokenize(full, grammar));
            let s = 0;
            for (const { node, offset, length } of typed) {
                while (s < spans.length && spans[s].end <= offset) s++;
                for (let k = s; k < spans.length && spans[k].start < offset + length; k++) {
                    const range = code.ownerDocument.createRange();
                    range.setStart(node, Math.max(spans[k].start, offset) - offset);
                    range.setEnd(node, Math.min(spans[k].end, offset + length) - offset);
                    let list = ranges.get(spans[k].group);
                    if (!list) ranges.set(spans[k].group, (list = []));
                    list.push(range);
                }
            }
        }
        const registry = this.win.CSS!.highlights!;
        for (const group of HIGHLIGHT_GROUPS) {
            const list = ranges.get(group);
            if (list) registry.set(`ak-${group}`, new this.win.Highlight!(...list));
            else registry.delete(`ak-${group}`);
        }
    }

    dispose(): void {
        this.blocks = [];
        if (!this.win) return;
        for (const group of HIGHLIGHT_GROUPS) this.win.CSS!.highlights!.delete(`ak-${group}`);
    }
}

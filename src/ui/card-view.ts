import { basicSides, buildClozeView, MARK_CLOSE, MARK_OPEN } from "../core/cloze-view";
import type { ClozeRef, FenceView } from "../core/cloze-view";
import { diffChars, isCorrect } from "../core/compare";
import type { Settings } from "../core/settings";
import type { Card } from "../core/types";
import { el, rangeFromOffsets } from "./dom";
import { LiveHighlighter, tokensToDom, type PrismLike } from "./live-highlight";
import { ClozeInput, detectIndentUnit } from "./typed-input";

/** What the card renderer needs from its host (Obsidian, or the browser demo). */
export interface RenderEnv {
    renderMarkdown(markdown: string, target: HTMLElement, sourcePath: string): Promise<void>;
    /** Null when no syntax highlighter is available; code is then shown uncoloured. */
    prism: PrismLike | null;
}

export interface RevealResult {
    /** Whether the card was answered by typing. */
    typed: boolean;
    /** For typed cards, whether every blank was right. */
    correct: boolean | null;
}

interface TypedBlank {
    slot: HTMLElement;
    input: ClozeInput;
    answer: DocumentFragment;
    expected: string;
    code: boolean;
}

interface RevealBlank {
    slot: HTMLElement;
    answer: DocumentFragment;
}

const MARKERS = new RegExp(`[${MARK_OPEN}${MARK_CLOSE}]`, "g");

/** Draws one card: its front, then (on reveal) its answer and how the typed text compares. */
export class CardView {
    readonly el: HTMLElement;
    private readonly doc: Document;
    private typed: TypedBlank[] = [];
    private blanks: RevealBlank[] = [];
    private highlighter: LiveHighlighter | null = null;
    private revealed = false;

    constructor(
        parent: HTMLElement,
        private readonly card: Card,
        private readonly env: RenderEnv,
        private readonly settings: Settings,
        private readonly callbacks: { onSubmit(): void; onEscape(): void },
    ) {
        this.doc = parent.ownerDocument;
        this.el = el(this.doc, "div", "ak-card");
        parent.append(this.el);
    }

    get hasTypedBlanks(): boolean {
        return this.typed.length > 0;
    }

    async renderFront(): Promise<void> {
        const { source, sub, path } = this.card;
        if (source.kind === "basic") {
            const front = el(this.doc, "div", "ak-prose");
            this.el.append(front);
            await this.env.renderMarkdown(basicSides(source, sub).front, front, path);
            return;
        }

        if (this.env.prism) this.highlighter = new LiveHighlighter(this.doc, this.env.prism);
        for (const seg of buildClozeView(source, sub)) {
            if (seg.type === "prose") {
                const prose = el(this.doc, "div", "ak-prose");
                this.el.append(prose);
                await this.env.renderMarkdown(seg.markdown, prose, path);
                for (const ref of seg.clozes) {
                    const range = findMarkedRange(prose);
                    if (!range) break;
                    this.carve(range, ref, null);
                }
                stripMarkers(prose);
            } else {
                this.renderFence(seg);
            }
        }
        // Blanks are carved back-to-front inside code, so restore reading order.
        this.typed.sort((a, b) =>
            a.slot.compareDocumentPosition(b.slot) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        );
        this.highlighter?.update();
    }

    private renderFence(seg: FenceView): void {
        const pre = el(this.doc, "pre", "ak-code");
        const code = el(this.doc, "code");
        pre.append(code);
        this.el.append(pre);

        const grammar = seg.lang ? this.env.prism?.languages[seg.lang] : undefined;
        if (grammar && this.env.prism) {
            code.className = `language-${seg.lang}`;
            pre.classList.add(`language-${seg.lang}`);
            code.append(tokensToDom(this.doc, this.env.prism.tokenize(seg.code, grammar)));
            this.highlighter?.add(code, grammar);
        } else {
            code.textContent = seg.code;
        }

        // Back to front, so earlier character offsets stay valid while we cut.
        for (const ref of [...seg.clozes].reverse()) {
            const range = rangeFromOffsets(code, ref.start, ref.end);
            if (range) this.carve(range, ref, { seg, start: ref.start });
        }
    }

    /**
     * Cut a rendered answer out of the DOM and leave a blank in its place.
     * The removed fragment keeps its formatting / syntax colours and is put back on reveal.
     */
    private carve(range: Range, ref: ClozeRef, fence: { seg: FenceView; start: number } | null) {
        const answer = range.extractContents();
        stripMarkers(answer);
        const slot = el(this.doc, "span", "ak-cloze");
        range.insertNode(slot);

        if (!ref.active) {
            slot.append(answer);
            return;
        }

        const mode = this.settings.typedClozes;
        const expected = answer.textContent ?? "";
        if (mode === "never" || (mode === "code" && !fence)) {
            slot.classList.add("ak-blank");
            slot.textContent = ref.hint ? `[${ref.hint}]` : "[...]";
            this.blanks.push({ slot, answer });
            return;
        }

        const lineStart = fence ? fence.seg.code.lastIndexOf("\n", fence.start - 1) + 1 : 0;
        const input = new ClozeInput(this.doc, {
            code: fence !== null,
            multiline: expected.includes("\n"),
            indentUnit: fence ? detectIndentUnit(fence.seg.code) : "",
            baseIndent: fence ? (/^[ \t]*/.exec(fence.seg.code.slice(lineStart))?.[0] ?? "") : "",
            hint: ref.hint,
            onEnter: () => this.focusAfter(input),
            onSubmit: () => this.callbacks.onSubmit(),
            onEscape: () => this.callbacks.onEscape(),
            onChange: () => this.highlighter?.update(),
        });
        slot.classList.add("ak-typed");
        slot.append(input.el);
        this.typed.push({ slot, input, answer, expected, code: fence !== null });
    }

    /** Enter in a single-line blank: move to the next blank, or check the card on the last. */
    private focusAfter(input: ClozeInput): void {
        const at = this.typed.findIndex((t) => t.input === input);
        const next = this.typed[at + 1];
        if (next) next.input.focus();
        else this.callbacks.onSubmit();
    }

    /** Focus the first blank. Returns false if there is nothing to type into. */
    focus(): boolean {
        if (this.revealed || this.typed.length === 0) return false;
        this.typed[0].input.focus();
        return true;
    }

    async reveal(): Promise<RevealResult> {
        if (this.revealed) return { typed: false, correct: null };
        this.revealed = true;
        this.highlighter?.dispose();

        const { source, sub, path } = this.card;
        if (source.kind === "basic") {
            this.el.append(el(this.doc, "hr", "ak-divider"));
            const back = el(this.doc, "div", "ak-prose ak-back");
            this.el.append(back);
            await this.env.renderMarkdown(basicSides(source, sub).back, back, path);
            return { typed: false, correct: null };
        }

        for (const { slot, answer } of this.blanks) {
            slot.textContent = "";
            slot.classList.remove("ak-blank");
            slot.classList.add("ak-answer");
            slot.append(answer);
        }

        const wrong: { typed: string; expected: string; code: boolean }[] = [];
        for (const blank of this.typed) {
            const typed = blank.input.value;
            const ok = isCorrect(typed, blank.expected, {
                code: blank.code,
                ignoreCase: this.settings.ignoreCase,
                lenientCodeWhitespace: this.settings.lenientCodeWhitespace,
            });
            if (!ok) wrong.push({ typed, expected: blank.expected, code: blank.code });
            blank.slot.textContent = "";
            blank.slot.classList.remove("ak-typed");
            blank.slot.classList.add("ak-answer", ok ? "is-correct" : "is-wrong");
            blank.slot.append(blank.answer);
        }
        if (wrong.length) this.el.append(this.feedback(wrong));
        return {
            typed: this.typed.length > 0,
            correct: this.typed.length > 0 ? wrong.length === 0 : null,
        };
    }

    /** "You typed" panel: each wrong answer, marked up against the expected one. */
    private feedback(wrong: { typed: string; expected: string; code: boolean }[]): HTMLElement {
        const panel = el(this.doc, "div", "ak-feedback");
        panel.append(el(this.doc, "div", "ak-feedback-title", "You typed"));
        for (const w of wrong) {
            const row = el(this.doc, w.code ? "pre" : "div", "ak-diff");
            const typed = w.typed.replace(/\s+$/, "");
            if (typed.trim() === "") {
                row.append(el(this.doc, "span", "ak-diff-none", "(nothing)"));
            } else {
                for (const part of diffChars(typed, w.expected)) {
                    const tag = part.op === "eq" ? "span" : part.op === "del" ? "del" : "ins";
                    row.append(el(this.doc, tag, undefined, part.text));
                }
            }
            panel.append(row);
        }
        const legend = el(this.doc, "div", "ak-feedback-legend");
        legend.append(
            el(this.doc, "del", undefined, "typed but wrong"),
            this.doc.createTextNode(" · "),
            el(this.doc, "ins", undefined, "missing"),
        );
        panel.append(legend);
        return panel;
    }

    destroy(): void {
        this.highlighter?.dispose();
        this.el.remove();
    }
}

/** The first MARK_OPEN…MARK_CLOSE pair in the rendered output, markers included. */
function findMarkedRange(root: HTMLElement): Range | null {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    let open = false;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        let from = 0;
        if (!open) {
            const at = node.data.indexOf(MARK_OPEN);
            if (at < 0) continue;
            range.setStart(node, at);
            open = true;
            from = at + 1;
        }
        const close = node.data.indexOf(MARK_CLOSE, from);
        if (close >= 0) {
            range.setEnd(node, close + 1);
            return range;
        }
    }
    return null;
}

function stripMarkers(root: Node): void {
    const doc = root.ownerDocument!;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        if (MARKERS.test(node.data)) node.data = node.data.replace(MARKERS, "");
        MARKERS.lastIndex = 0;
    }
}

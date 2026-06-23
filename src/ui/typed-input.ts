import { el, readText } from "./dom";

export interface ClozeInputOptions {
    /** The blank sits inside a code block. */
    code: boolean;
    /** The expected answer spans several lines, so Enter inserts a newline. */
    multiline: boolean;
    /** One level of indentation in the surrounding code. */
    indentUnit: string;
    /** Indentation of the code line the blank starts on. */
    baseIndent: string;
    hint?: string;
    /** Enter on a single-line blank. */
    onEnter(): void;
    /** Ctrl/Cmd+Enter anywhere. */
    onSubmit(): void;
    onChange(): void;
    onEscape(): void;
}

/**
 * An inline, in-flow editable blank.
 *
 * It is a plain-text contenteditable <span>, so it inherits the font, weight and colour of
 * whatever surrounds it (bold prose, monospace code), grows as you type, and can wrap onto
 * new lines inside a <pre> exactly like the code it replaces.
 */
export class ClozeInput {
    readonly el: HTMLSpanElement;

    constructor(
        doc: Document,
        private readonly options: ClozeInputOptions,
    ) {
        const span = el(doc, "span", "ak-input");
        span.contentEditable = "plaintext-only";
        // Engines without plaintext-only fall back to rich editing; we only ever read text.
        if (span.contentEditable !== "plaintext-only") span.contentEditable = "true";
        span.spellcheck = false;
        span.setAttribute("autocapitalize", "off");
        span.setAttribute("autocorrect", "off");
        span.setAttribute("role", "textbox");
        span.setAttribute("aria-label", options.hint ? `Answer (${options.hint})` : "Answer");
        span.dataset.placeholder = options.hint ?? "\u00a0\u00a0\u00a0\u00a0";
        if (options.multiline) span.setAttribute("aria-multiline", "true");
        if (options.code) span.classList.add("ak-input-code");
        span.addEventListener("keydown", (e) => this.onKeyDown(e));
        span.addEventListener("input", () => {
            this.trimSentinel();
            this.syncEmpty();
            options.onChange();
        });
        this.el = span;
        this.syncEmpty();
    }

    get value(): string {
        return readText(this.el);
    }

    focus(): void {
        this.el.focus();
    }

    /** `:empty` does not match once the browser leaves a stray <br> behind, so track it. */
    private syncEmpty(): void {
        const value = this.value;
        this.el.classList.toggle("is-empty", value === "" || value === "\n");
    }

    /**
     * Browsers append an extra line break after a newline typed at the end of an editable, so
     * the caret has a line to sit on. Inside a code block that shows up as a phantom blank
     * line below the blank. Drop it unless the caret really is on that empty last line.
     */
    private trimSentinel(): void {
        const value = this.value;
        if (!value.endsWith("\n") || value === "\n") return;
        const before = this.textBeforeCaret();
        if (before.length === value.length - 1 && before.endsWith("\n")) return;
        if (before.length === value.length) return;
        let last: Node | null = this.el.lastChild;
        while (last && last.nodeType === Node.ELEMENT_NODE && last.nodeName !== "BR") {
            last = last.lastChild;
        }
        if (!last) return;
        if (last.nodeName === "BR") last.parentNode?.removeChild(last);
        else if (last.nodeType === Node.TEXT_NODE && (last as Text).data.endsWith("\n")) {
            (last as Text).deleteData((last as Text).data.length - 1, 1);
        }
    }

    private insert(text: string): void {
        this.el.ownerDocument.execCommand("insertText", false, text);
    }

    /** The text between the start of the blank and the caret. */
    private textBeforeCaret(): string {
        const sel = this.el.ownerDocument.getSelection();
        if (!sel || sel.rangeCount === 0 || !this.el.contains(sel.focusNode)) return this.value;
        const range = this.el.ownerDocument.createRange();
        range.selectNodeContents(this.el);
        range.setEnd(sel.focusNode!, sel.focusOffset);
        return readText(range.cloneContents());
    }

    private onKeyDown(e: KeyboardEvent): void {
        // Keep the review view's own hotkeys (space, 1–4, u…) from firing while typing.
        e.stopPropagation();
        if (e.isComposing) return;

        if (e.key === "Escape") {
            e.preventDefault();
            this.options.onEscape();
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            if (e.metaKey || e.ctrlKey) return this.options.onSubmit();
            if (!this.options.multiline) return this.options.onEnter();
            this.insert("\n" + (this.options.code ? this.nextLineIndent() : ""));
            return;
        }
        if (e.key === "Tab" && !e.shiftKey && this.options.code && this.options.multiline) {
            e.preventDefault();
            this.insert(this.options.indentUnit);
        }
    }

    /** Indentation for a new line: same as the current line, one deeper after an opener. */
    private nextLineIndent(): string {
        const before = this.textBeforeCaret();
        const nl = before.lastIndexOf("\n");
        const line = before.slice(nl + 1);
        const indent = nl < 0 ? this.options.baseIndent : (/^[ \t]*/.exec(line)?.[0] ?? "");
        return /[:{([]\s*$/.test(line) ? indent + this.options.indentUnit : indent;
    }
}

/** Guess one indentation level from a block of code. */
export function detectIndentUnit(code: string): string {
    let smallest = Infinity;
    for (const line of code.split("\n")) {
        if (line.startsWith("\t")) return "\t";
        const n = /^ +/.exec(line)?.[0].length ?? 0;
        if (n >= 2 && n < smallest) smallest = n;
    }
    return " ".repeat(Number.isFinite(smallest) ? smallest : 4);
}

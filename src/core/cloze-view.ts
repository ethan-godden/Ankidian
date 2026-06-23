import type { CardSource } from "./types";

/** Private-use characters that bracket a cloze answer through the Markdown renderer. */
export const MARK_OPEN = "";
export const MARK_CLOSE = "";

export interface ClozeRef {
    group: string;
    active: boolean;
    answer: string;
    hint?: string;
}

export interface ProseView {
    type: "prose";
    /** Markdown with every cloze replaced by MARK_OPEN + answer + MARK_CLOSE. */
    markdown: string;
    /** Clozes in the order their markers appear. */
    clozes: ClozeRef[];
}

export interface FenceView {
    type: "fence";
    lang: string;
    /** The complete code, with every cloze replaced by its answer. */
    code: string;
    /** Clozes with their character range in `code`. */
    clozes: (ClozeRef & { start: number; end: number })[];
}

export type SegmentView = ProseView | FenceView;

/**
 * Describe how to draw a cloze card for one sibling.
 *
 * Every segment is produced with *all* answers filled in. The renderer draws that complete
 * text (so Markdown and syntax highlighting see real content) and then cuts the active
 * answers back out of the rendered DOM. The cut-out piece is the formatted answer.
 */
export function buildClozeView(source: CardSource, activeGroup: string): SegmentView[] {
    const { body } = source;
    return source.segments.map((seg): SegmentView => {
        const from = seg.type === "fence" ? seg.codeStart : seg.start;
        const to = seg.type === "fence" ? seg.codeEnd : seg.end;
        const inside = source.clozes.filter((c) => c.start >= from && c.end <= to);

        let out = "";
        let cursor = from;
        const refs: (ClozeRef & { start: number; end: number })[] = [];
        for (const c of inside) {
            out += body.slice(cursor, c.start);
            const ref = {
                group: c.group,
                active: c.group === activeGroup,
                answer: c.answer,
                hint: c.hint,
            };
            if (seg.type === "fence") {
                refs.push({ ...ref, start: out.length, end: out.length + c.answer.length });
                out += c.answer;
            } else {
                refs.push({ ...ref, start: 0, end: 0 });
                out += MARK_OPEN + c.answer + MARK_CLOSE;
            }
            cursor = c.end;
        }
        out += body.slice(cursor, to);

        if (seg.type === "fence") {
            return { type: "fence", lang: seg.lang, code: out, clozes: refs };
        }
        return {
            type: "prose",
            markdown: out,
            clozes: refs.map(({ group, active, answer, hint }) => ({ group, active, answer, hint })),
        };
    });
}

/** Markdown for one side of a basic card. */
export function basicSides(source: CardSource, sub: string): { front: string; back: string } {
    return sub === "r"
        ? { front: source.back, back: source.front }
        : { front: source.front, back: source.back };
}

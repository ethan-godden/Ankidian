/** One cloze deletion inside a card body. Offsets are into `CardSource.body`. */
export interface ClozeSpan {
    /** Sibling group: "c1", "c2"… for `{{c1::…}}`, "h1", "h2"… for `==…==`. */
    group: string;
    /** Start of the whole token (including delimiters). */
    start: number;
    /** End of the whole token (exclusive). */
    end: number;
    answer: string;
    hint?: string;
}

export interface ProseSegment {
    type: "prose";
    start: number;
    end: number;
}

export interface FenceSegment {
    type: "fence";
    start: number;
    end: number;
    lang: string;
    /** The code between the fence lines, without the trailing newline. */
    codeStart: number;
    codeEnd: number;
}

export type Segment = ProseSegment | FenceSegment;

/**
 * A block of a note that produces one or more cards ("siblings").
 * This is what carries the block ID; schedules are keyed by `id + ":" + sub`.
 */
export interface CardSource {
    kind: "cloze" | "basic";
    /** Block ID (`ak-xxxxxx`) or null if the card has never been reviewed. */
    id: string | null;
    /** 0-based, inclusive line range in the note, including a standalone ID line. */
    lineStart: number;
    lineEnd: number;
    /** Source text with the block ID removed. */
    body: string;
    /** Headings above the card, outermost first. */
    headings: string[];
    /** Sibling keys, in review order. */
    subs: string[];

    // cloze cards
    segments: Segment[];
    clozes: ClozeSpan[];

    // basic cards
    front: string;
    back: string;
}

/** One reviewable card: a source plus which sibling of it. */
export interface Card {
    source: CardSource;
    sub: string;
    path: string;
    deck: string;
}

export function cardKey(card: Card): string | null {
    return card.source.id ? `${card.source.id}:${card.sub}` : null;
}

export type Grade = 1 | 2 | 3 | 4;

export const GRADE_LABELS: Record<Grade, string> = {
    1: "Again",
    2: "Hard",
    3: "Good",
    4: "Easy",
};

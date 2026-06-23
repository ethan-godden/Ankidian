import type { ReviewLog } from "./review-log";
import type { CardState, ReviewEntry } from "./scheduler";
import { cardKey, type Card, type Grade } from "./types";

/** Learning cards due within this window are shown again in the same session. */
export const LEARN_AHEAD_MS = 20 * 60_000;

export interface DeckCounts {
    new: number;
    learning: number;
    due: number;
    total: number;
}

export type Bucket = "new" | "learning" | "due" | "later";

export function bucketOf(state: CardState | null, now: number): Bucket {
    if (!state) return "new";
    if (state.status === "learning" || state.status === "relearning") {
        return state.due <= now + LEARN_AHEAD_MS ? "learning" : "later";
    }
    return state.due <= now ? "due" : "later";
}

/** Start of the current "day" (which begins at `dayStartHour`), epoch ms. */
export function dayStart(now: number, dayStartHour: number): number {
    const d = new Date(now);
    d.setHours(dayStartHour, 0, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
}

/** Is `deck` the same as, or nested under, `parent`? An empty parent matches everything. */
export function inDeck(deck: string, parent: string): boolean {
    return parent === "" || deck === parent || deck.startsWith(parent + "/");
}

export interface DeckRow {
    /** Full path, e.g. "python/basics". */
    deck: string;
    name: string;
    depth: number;
    /** Counts including nested decks. */
    counts: DeckCounts;
}

/** One row per deck (and per parent of a deck), sorted as a tree. */
export function deckRows(cards: readonly Card[], log: ReviewLog, now: number): DeckRow[] {
    const rows = new Map<string, DeckRow>();
    const row = (deck: string): DeckRow => {
        let r = rows.get(deck);
        if (!r) {
            const parts = deck.split("/");
            r = {
                deck,
                name: parts[parts.length - 1],
                depth: parts.length - 1,
                counts: { new: 0, learning: 0, due: 0, total: 0 },
            };
            rows.set(deck, r);
        }
        return r;
    };
    for (const card of cards) {
        const bucket = bucketOf(log.state(cardKey(card)), now);
        const parts = card.deck.split("/");
        for (let n = 1; n <= parts.length; n++) {
            const counts = row(parts.slice(0, n).join("/")).counts;
            counts.total++;
            if (bucket !== "later") counts[bucket]++;
        }
    }
    return [...rows.values()].sort((a, b) => a.deck.localeCompare(b.deck));
}

export interface SessionOptions {
    /** How many more new cards may be introduced today. */
    newRemaining: number;
    burySiblings: boolean;
}

interface Pending {
    card: Card;
    /** When the card becomes due in this session (0 for cards that are ready now). */
    at: number;
}

interface Step {
    card: Card;
    entry: ReviewEntry;
    pendingBefore: Pending[];
}

/** One sitting: a snapshot queue of cards, graded one at a time, with undo. */
export class Session {
    private pending: Pending[] = [];
    private history: Step[] = [];
    done = 0;

    constructor(
        cards: readonly Card[],
        private readonly log: ReviewLog,
        now: number,
        private readonly options: SessionOptions,
    ) {
        const learning: Pending[] = [];
        const due: Pending[] = [];
        const fresh: Pending[] = [];
        const seenNewSources = new Set<object>();
        for (const card of cards) {
            const state = log.state(cardKey(card));
            const bucket = bucketOf(state, now);
            if (bucket === "learning") learning.push({ card, at: state!.due });
            else if (bucket === "due") due.push({ card, at: state!.due });
            else if (bucket === "new") {
                // Introduce one sibling of a brand-new note block at a time.
                if (options.burySiblings && seenNewSources.has(card.source)) continue;
                seenNewSources.add(card.source);
                fresh.push({ card, at: 0 });
            }
        }
        learning.sort((a, b) => a.at - b.at);
        due.sort((a, b) => a.at - b.at);
        // Overdue reviews are ready immediately; `at` only orders them.
        for (const p of due) p.at = 0;
        this.pending = [...learning, ...due, ...fresh.slice(0, Math.max(0, options.newRemaining))];
    }

    get remaining(): number {
        return this.pending.length;
    }

    get canUndo(): boolean {
        return this.history.length > 0;
    }

    /** The card to show now: the first ready one, else the soonest learning card. */
    current(now: number): Card | null {
        if (this.pending.length === 0) return null;
        const ready = this.pending.find((p) => p.at <= now);
        if (ready) return ready.card;
        return this.pending.reduce((a, b) => (b.at < a.at ? b : a)).card;
    }

    /**
     * Grade the current card. The card must already have a block ID.
     * Returns the entry to persist.
     */
    grade(card: Card, grade: Grade, now: number, extra: Partial<ReviewEntry> = {}): ReviewEntry {
        const key = cardKey(card);
        if (key === null) throw new Error("Card has no block ID");
        const entry: ReviewEntry = { k: key, t: now, r: grade, ...extra };
        const pendingBefore = [...this.pending];

        this.log.add(entry);
        this.pending = this.pending.filter(
            (p) =>
                p.card !== card &&
                !(this.options.burySiblings && p.card.source === card.source && p.at === 0),
        );
        const state = this.log.state(key)!;
        if (bucketOf(state, now) === "learning") this.pending.push({ card, at: state.due });

        this.history.push({ card, entry, pendingBefore });
        this.done++;
        return entry;
    }

    /** Drop a card from this session without grading it. */
    skip(card: Card): void {
        this.pending = this.pending.filter((p) => p.card !== card);
    }

    /** Take back the last grade. Returns the entry to delete from storage. */
    undo(): ReviewEntry | null {
        const step = this.history.pop();
        if (!step) return null;
        this.log.remove(step.entry);
        this.pending = step.pendingBefore;
        this.done--;
        return step.entry;
    }
}

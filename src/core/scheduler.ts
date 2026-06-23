import { DefaultScheduler } from "ts-fsrs";

import type { Grade } from "./types";

/** One answered review. This is the only thing Ankidian persists about scheduling. */
export interface ReviewEntry {
    /** Card key: `blockId:sub`. */
    k: string;
    /** When the review happened (epoch ms). */
    t: number;
    /** Grade given: 1 Again, 2 Hard, 3 Good, 4 Easy. */
    r: Grade;
    /** Time spent on the card, ms. */
    ms?: number;
    /** For typed cards: whether the typed answer was correct. */
    ok?: boolean;
}

export type CardStatus = "new" | "learning" | "review" | "relearning";

export interface CardState {
    status: CardStatus;
    /** Epoch ms. */
    due: number;
    stability: number;
    difficulty: number;
    reps: number;
    lapses: number;
    /** The FSRS card this state was derived from. */
    raw: FsrsCard;
}

const makeFsrs = () => DefaultScheduler({ version: "FSRS-7" });
type FsrsScheduler = Awaited<ReturnType<typeof makeFsrs>>;
type FsrsCard = ReturnType<FsrsScheduler["newCard"]>;

export interface SchedulerOptions {
    desiredRetention: number;
    maximumIntervalDays: number;
}

const STATUSES: CardStatus[] = ["new", "learning", "review", "relearning"];

/** A thin, deterministic wrapper around FSRS: card state is always a fold over review entries. */
export class Scheduler {
    private constructor(private readonly fsrs: FsrsScheduler) {}

    static async create(options: SchedulerOptions): Promise<Scheduler> {
        const fsrs = await DefaultScheduler({
            version: "FSRS-7",
            desiredRetention: Math.min(0.99, Math.max(0.7, options.desiredRetention)),
            maximumInterval: Math.max(1, options.maximumIntervalDays),
            enableFuzz: false,
        });
        return new Scheduler(fsrs);
    }

    /** State after one more review. `state` is null for a card that has never been reviewed. */
    apply(state: CardState | null, grade: Grade, at: number): CardState {
        const now = new Date(at);
        const card = state?.raw ?? this.fsrs.newCard({ now });
        return toState(this.fsrs.review({ card, grade, now }).card);
    }

    /** Rebuild a card's state from its full history (sorted by time). Null if it has none. */
    replay(entries: readonly ReviewEntry[]): CardState | null {
        let state: CardState | null = null;
        for (const e of entries) state = this.apply(state, e.r, e.t);
        return state;
    }

    /** When the card would next be due for each possible grade. */
    preview(state: CardState | null, at: number): Record<Grade, number> {
        const out = {} as Record<Grade, number>;
        for (const g of [1, 2, 3, 4] as Grade[]) out[g] = this.apply(state, g, at).due;
        return out;
    }
}

function toState(card: FsrsCard): CardState {
    return {
        status: STATUSES[card.state as number] ?? "review",
        due: new Date(card.dueAt as Date).getTime(),
        stability: card.stability,
        difficulty: card.difficulty,
        reps: card.reps,
        lapses: card.lapses,
        raw: card,
    };
}

/** "<1m", "10m", "3h", "4d", "2.5mo", "1.2y" */
export function formatInterval(ms: number): string {
    const min = ms / 60_000;
    if (min < 1) return "<1m";
    if (min < 60) return `${Math.round(min)}m`;
    const hours = min / 60;
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = hours / 24;
    if (days < 30) return `${Math.round(days)}d`;
    if (days < 365) return `${trim1(days / 30)}mo`;
    return `${trim1(days / 365)}y`;
}

function trim1(n: number): string {
    return n.toFixed(1).replace(/\.0$/, "");
}

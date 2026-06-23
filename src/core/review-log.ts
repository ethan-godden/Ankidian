import type { CardState, ReviewEntry, Scheduler } from "./scheduler";

/** Parse a JSON-lines review log, skipping anything malformed. */
export function parseLog(text: string): ReviewEntry[] {
    const out: ReviewEntry[] = [];
    for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
            const e = JSON.parse(line) as ReviewEntry;
            if (typeof e.k === "string" && typeof e.t === "number" && e.r >= 1 && e.r <= 4) {
                out.push(e);
            }
        } catch {
            // A half-written or conflicted line: ignore it rather than lose the whole log.
        }
    }
    return out;
}

export function serializeEntry(entry: ReviewEntry): string {
    return JSON.stringify(entry) + "\n";
}

/**
 * Every review ever recorded, merged across devices, with card state derived on demand.
 *
 * Nothing but the entries is stored. Because scheduling is deterministic, two devices that
 * hold the same entries always agree on every card's state, so syncing is a set union.
 */
export class ReviewLog {
    private byCard = new Map<string, ReviewEntry[]>();
    private states = new Map<string, CardState | null>();

    constructor(private scheduler: Scheduler) {}

    /** Replace the contents with the union of the given logs. */
    load(logs: Iterable<readonly ReviewEntry[]>): void {
        this.byCard.clear();
        this.states.clear();
        const seen = new Set<string>();
        for (const log of logs) {
            for (const e of log) {
                const sig = `${e.k}|${e.t}|${e.r}`;
                if (seen.has(sig)) continue;
                seen.add(sig);
                let list = this.byCard.get(e.k);
                if (!list) this.byCard.set(e.k, (list = []));
                list.push(e);
            }
        }
        for (const list of this.byCard.values()) list.sort((a, b) => a.t - b.t);
    }

    setScheduler(scheduler: Scheduler): void {
        this.scheduler = scheduler;
        this.states.clear();
    }

    add(entry: ReviewEntry): void {
        let list = this.byCard.get(entry.k);
        if (!list) this.byCard.set(entry.k, (list = []));
        list.push(entry);
        list.sort((a, b) => a.t - b.t);
        this.states.delete(entry.k);
    }

    remove(entry: ReviewEntry): void {
        const list = this.byCard.get(entry.k);
        if (!list) return;
        const at = list.findIndex((e) => e.t === entry.t && e.r === entry.r);
        if (at >= 0) list.splice(at, 1);
        if (list.length === 0) this.byCard.delete(entry.k);
        this.states.delete(entry.k);
    }

    entries(key: string): readonly ReviewEntry[] {
        return this.byCard.get(key) ?? [];
    }

    /** Current state of a card, or null if it has never been reviewed. */
    state(key: string | null): CardState | null {
        if (key === null) return null;
        let state = this.states.get(key);
        if (state === undefined) {
            state = this.scheduler.replay(this.entries(key));
            this.states.set(key, state);
        }
        return state;
    }

    /** How many cards had their very first review at or after `since`. */
    introducedSince(since: number): number {
        let n = 0;
        for (const list of this.byCard.values()) if (list[0].t >= since) n++;
        return n;
    }

    /** How many reviews happened at or after `since`. */
    reviewsSince(since: number): number {
        let n = 0;
        for (const list of this.byCard.values()) for (const e of list) if (e.t >= since) n++;
        return n;
    }

    get size(): number {
        let n = 0;
        for (const list of this.byCard.values()) n += list.length;
        return n;
    }
}

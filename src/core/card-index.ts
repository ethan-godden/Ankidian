import { parseNote, type ParseOptions } from "./parser";
import type { Card, CardSource } from "./types";

/**
 * Which deck a note's cards belong to, from its tags.
 * `#flashcards/python/basics` → "python/basics"; plain `#flashcards` → "Default".
 * Returns null when the note is not a flashcard note.
 */
export function deckFromTags(tags: readonly string[], baseTag: string): string | null {
    const base = baseTag.replace(/^#/, "").toLowerCase();
    let deck: string | null = null;
    for (const raw of tags) {
        const tag = raw.replace(/^#/, "");
        const lower = tag.toLowerCase();
        if (lower === base) deck ??= "Default";
        else if (lower.startsWith(base + "/")) {
            const sub = tag.slice(base.length + 1).replace(/\/+$/, "");
            if (sub && (deck === null || deck === "Default")) deck = sub;
        }
    }
    return deck;
}

interface NoteEntry {
    deck: string;
    sources: CardSource[];
}

/** The in-memory index of every card in the vault, updated one note at a time. */
export class CardIndex {
    private notes = new Map<string, NoteEntry>();
    private listeners = new Set<() => void>();
    private cached: Card[] | null = null;

    constructor(private options: ParseOptions & { flashcardTag: string }) {}

    setOptions(options: ParseOptions & { flashcardTag: string }): void {
        this.options = options;
    }

    /** Index (or re-index) one note. Returns whether anything changed. */
    setNote(path: string, text: string | null, tags: readonly string[]): boolean {
        const deck = deckFromTags(tags, this.options.flashcardTag);
        if (deck === null || text === null) return this.removeNote(path);
        const sources = parseNote(text, this.options);
        if (sources.length === 0) return this.removeNote(path);
        this.notes.set(path, { deck, sources });
        this.changed();
        return true;
    }

    removeNote(path: string): boolean {
        if (!this.notes.delete(path)) return false;
        this.changed();
        return true;
    }

    renameNote(from: string, to: string): void {
        const entry = this.notes.get(from);
        if (!entry) return;
        this.notes.delete(from);
        this.notes.set(to, entry);
        this.changed();
    }

    clear(): void {
        this.notes.clear();
        this.changed();
    }

    has(path: string): boolean {
        return this.notes.has(path);
    }

    /** Every card, in vault order. */
    cards(): Card[] {
        if (this.cached) return this.cached;
        const out: Card[] = [];
        for (const [path, { deck, sources }] of this.notes) {
            for (const source of sources) {
                for (const sub of source.subs) out.push({ source, sub, path, deck });
            }
        }
        return (this.cached = out);
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private changed(): void {
        this.cached = null;
        for (const l of this.listeners) l();
    }
}

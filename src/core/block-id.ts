import { parseNote, type ParseOptions } from "./parser";
import type { CardSource } from "./types";

export function newBlockId(random: () => number = Math.random): string {
    let s = "";
    while (s.length < 6) s += Math.floor(random() * 36).toString(36);
    return `ak-${s}`;
}

export interface EnsureIdResult {
    /** The note text, with the ID inserted if it was missing. */
    text: string;
    /** The card's block ID, or null if the card can no longer be found in the note. */
    id: string | null;
}

/**
 * Make sure the card source identified by its body text has a block ID in `text`.
 *
 * The note may have been edited since the card was indexed, so the card is located by
 * content (nearest match to `lineHint`) rather than trusted line numbers.
 */
export function ensureBlockId(
    text: string,
    source: Pick<CardSource, "body" | "lineStart">,
    options: ParseOptions,
    makeId: () => string = newBlockId,
): EnsureIdResult {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const candidates = parseNote(text, options).filter((s) => s.body === source.body);
    if (candidates.length === 0) return { text, id: null };
    candidates.sort(
        (a, b) =>
            Math.abs(a.lineStart - source.lineStart) - Math.abs(b.lineStart - source.lineStart),
    );
    const target = candidates[0];
    if (target.id) return { text, id: target.id };

    const id = makeId();
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const last = lines[target.lineEnd];
    const needsOwnLine = /^\s*(`{3,}|~{3,})\s*$/.test(last) || /^\s*\|.*\|\s*$/.test(last);
    if (needsOwnLine) {
        // Obsidian wants IDs for code blocks and tables on their own line, set off by blank lines.
        const insert = ["", `^${id}`];
        const next = lines[target.lineEnd + 1];
        if (next !== undefined && next.trim() !== "") insert.push("");
        lines.splice(target.lineEnd + 1, 0, ...insert);
    } else {
        lines[target.lineEnd] = `${last.replace(/\s+$/, "")} ^${id}`;
    }
    return { text: lines.join(eol), id };
}

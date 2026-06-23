export type TypedMode = "always" | "code" | "never";

export interface Settings {
    /** Notes carrying this tag (or a nested tag) are scanned for cards. No leading "#". */
    flashcardTag: string;
    /** Treat ==highlights== in prose as cloze deletions. */
    highlightClozes: boolean;
    /** Which cloze deletions are answered by typing rather than revealing. */
    typedClozes: TypedMode;
    /** Ignore upper/lower case when checking typed prose answers. Code is always case-sensitive. */
    ignoreCase: boolean;
    /** Treat any run of whitespace in a typed code answer as a single space. */
    lenientCodeWhitespace: boolean;
    newPerDay: number;
    desiredRetention: number;
    maximumIntervalDays: number;
    /** After answering a card, hold its siblings back until the next session. */
    burySiblings: boolean;
    /** Vault folder holding the per-device review logs. */
    dataFolder: string;
    /** Hour (0–23) at which a new "day" starts for the new-card limit. */
    dayStartHour: number;
}

export const DEFAULT_SETTINGS: Settings = {
    flashcardTag: "flashcards",
    highlightClozes: true,
    typedClozes: "always",
    ignoreCase: true,
    lenientCodeWhitespace: false,
    newPerDay: 20,
    desiredRetention: 0.9,
    maximumIntervalDays: 36500,
    burySiblings: true,
    dataFolder: "Ankidian",
    dayStartHour: 4,
};

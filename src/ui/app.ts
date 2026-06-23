import type { ReviewLog } from "../core/review-log";
import { formatInterval, type ReviewEntry, type Scheduler } from "../core/scheduler";
import { dayStart, deckRows, inDeck, Session } from "../core/session";
import type { Settings } from "../core/settings";
import { cardKey, GRADE_LABELS, type Card, type Grade } from "../core/types";
import { CardView, type RenderEnv, type RevealResult } from "./card-view";
import { el } from "./dom";

/** Everything the review UI needs from its host. Obsidian and the browser demo both implement it. */
export interface Backend {
    settings: Settings;
    log: ReviewLog;
    scheduler: Scheduler;
    env: RenderEnv;
    cards(): Card[];
    /** Give the card's block an ID in its note if it has none. Null if the card is gone. */
    ensureId(card: Card): Promise<string | null>;
    record(entry: ReviewEntry): Promise<void>;
    unrecord(entry: ReviewEntry): Promise<void>;
    openSource(card: Card): void;
    notify(message: string): void;
    /** Called when cards or the review log change outside the UI. */
    onChange(listener: () => void): () => void;
}

/** The deck list and the review screen, in one container. */
export class ReviewApp {
    private readonly doc: Document;
    private readonly unsubscribe: () => void;
    private session: Session | null = null;
    private deck = "";
    private view: CardView | null = null;
    private current: Card | null = null;
    private result: RevealResult | null = null;
    private shownAt = 0;
    private busy = false;
    private refreshTimer: number | null = null;

    constructor(
        private readonly root: HTMLElement,
        private readonly backend: Backend,
    ) {
        this.doc = root.ownerDocument;
        root.classList.add("ak-root");
        root.tabIndex = -1;
        root.addEventListener("keydown", (e) => this.onKeyDown(e));
        this.unsubscribe = backend.onChange(() => {
            if (this.session) return;
            const win = this.doc.defaultView!;
            if (this.refreshTimer !== null) win.clearTimeout(this.refreshTimer);
            this.refreshTimer = win.setTimeout(() => !this.session && this.showDecks(), 150);
        });
        this.showDecks();
    }

    destroy(): void {
        this.unsubscribe();
        this.view?.destroy();
        this.root.textContent = "";
    }

    // ───────────────────────────── decks ─────────────────────────────

    showDecks(): void {
        this.session = null;
        this.view?.destroy();
        this.view = null;
        this.current = null;
        this.root.textContent = "";

        const now = Date.now();
        const cards = this.backend.cards();
        const rows = deckRows(cards, this.backend.log, now);
        const page = el(this.doc, "div", "ak-page");
        this.root.append(page);
        page.append(el(this.doc, "h2", "ak-title", "Decks"));

        if (rows.length === 0) {
            const tag = this.backend.settings.flashcardTag;
            const empty = el(this.doc, "div", "ak-empty");
            empty.append(
                el(this.doc, "p", undefined, `No cards yet. Tag a note with #${tag} and add a card:`),
                el(
                    this.doc,
                    "pre",
                    undefined,
                    [
                        "The capital of France is {{c1::Paris}}.",
                        "",
                        "```python",
                        "def add(a, b):",
                        "    return {{c1::a + b}}",
                        "```",
                    ].join("\n"),
                ),
            );
            page.append(empty);
            return;
        }

        const today = dayStart(now, this.backend.settings.dayStartHour);
        page.append(
            el(
                this.doc,
                "p",
                "ak-subtitle",
                `${cards.length} cards · ${this.backend.log.reviewsSince(today)} reviewed today`,
            ),
        );

        const table = el(this.doc, "div", "ak-decks");
        const head = el(this.doc, "div", "ak-deck ak-deck-head");
        head.append(
            el(this.doc, "span", "ak-deck-name", "Deck"),
            el(this.doc, "span", "ak-count", "New"),
            el(this.doc, "span", "ak-count", "Learn"),
            el(this.doc, "span", "ak-count", "Due"),
        );
        table.append(head);
        for (const row of rows) {
            const button = el(this.doc, "button", "ak-deck");
            const name = el(this.doc, "span", "ak-deck-name", row.name);
            name.style.paddingInlineStart = `${row.depth * 1.25}em`;
            button.append(
                name,
                count(this.doc, row.counts.new, "ak-new"),
                count(this.doc, row.counts.learning, "ak-learning"),
                count(this.doc, row.counts.due, "ak-due"),
            );
            button.addEventListener("click", () => this.start(row.deck));
            table.append(button);
        }
        page.append(table);
        if (rows.length > 1) {
            const all = el(this.doc, "button", "ak-button mod-cta", "Review all decks");
            all.addEventListener("click", () => this.start(""));
            page.append(all);
        }
    }

    /** Begin reviewing a deck (and its sub-decks). `filter` narrows it further, e.g. to one note. */
    start(deck: string, filter?: (card: Card) => boolean): void {
        const { settings, log } = this.backend;
        const now = Date.now();
        const cards = this.backend
            .cards()
            .filter((c) => inDeck(c.deck, deck) && (!filter || filter(c)));
        const introduced = log.introducedSince(dayStart(now, settings.dayStartHour));
        this.deck = deck;
        this.session = new Session(cards, log, now, {
            newRemaining: settings.newPerDay - introduced,
            burySiblings: settings.burySiblings,
        });
        void this.showNext();
    }

    // ───────────────────────────── review ─────────────────────────────

    private async showNext(): Promise<void> {
        const session = this.session;
        if (!session) return;
        this.view?.destroy();
        this.view = null;
        this.result = null;
        this.root.textContent = "";

        const page = el(this.doc, "div", "ak-page ak-review");
        this.root.append(page);

        const bar = el(this.doc, "div", "ak-bar");
        const back = el(this.doc, "button", "ak-button", "← Decks");
        back.addEventListener("click", () => this.showDecks());
        const title = el(this.doc, "span", "ak-bar-title", this.deck || "All decks");
        const left = el(this.doc, "span", "ak-bar-count", `${session.remaining} left`);
        const undo = el(this.doc, "button", "ak-button", "Undo");
        undo.disabled = !session.canUndo;
        undo.title = "Take back the last answer (U)";
        undo.addEventListener("click", () => void this.undo());
        bar.append(back, title, left, undo);
        page.append(bar);

        const card = (this.current = session.current(Date.now()));
        if (!card) {
            const done = el(this.doc, "div", "ak-done");
            done.append(
                el(this.doc, "h3", undefined, "Done for now"),
                el(
                    this.doc,
                    "p",
                    undefined,
                    session.done === 0
                        ? "Nothing is due in this deck."
                        : `You reviewed ${session.done} card${session.done === 1 ? "" : "s"}.`,
                ),
            );
            page.append(done);
            this.root.focus();
            return;
        }

        const context = el(this.doc, "div", "ak-context");
        const note = card.path.replace(/^.*\//, "").replace(/\.md$/, "");
        const crumbs = [note, ...card.source.headings.filter((h, i) => i > 0 || h !== note)];
        const open = el(this.doc, "a", "ak-context-link", crumbs.join(" › "));
        open.title = "Open this card in its note";
        open.addEventListener("click", () => this.backend.openSource(card));
        context.append(open);
        page.append(context);

        const stage = el(this.doc, "div", "ak-stage");
        page.append(stage);
        const view = (this.view = new CardView(stage, card, this.backend.env, this.backend.settings, {
            onSubmit: () => void this.reveal(),
            onEscape: () => this.root.focus(),
        }));
        const actions = el(this.doc, "div", "ak-actions");
        page.append(actions);

        await view.renderFront();
        if (this.view !== view) return; // superseded while rendering

        const show = el(
            this.doc,
            "button",
            "ak-button mod-cta ak-show",
            view.hasTypedBlanks ? "Check answer" : "Show answer",
        );
        show.addEventListener("click", () => void this.reveal());
        actions.append(
            show,
            el(
                this.doc,
                "span",
                "ak-keys",
                view.hasTypedBlanks ? "Enter to check · Ctrl/⌘+Enter from a multi-line blank" : "Space",
            ),
        );
        this.shownAt = Date.now();
        if (!view.focus()) this.root.focus();
    }

    private async reveal(): Promise<void> {
        const view = this.view;
        const card = this.current;
        if (!view || !card || this.result || this.busy) return;
        this.busy = true;
        try {
            this.result = await view.reveal();
        } finally {
            this.busy = false;
        }

        const actions = this.root.querySelector(".ak-actions")!;
        actions.textContent = "";
        const suggested = this.suggestedGrade();
        const now = Date.now();
        const preview = this.backend.scheduler.preview(this.backend.log.state(cardKey(card)), now);
        const grades = el(this.doc, "div", "ak-grades");
        for (const g of [1, 2, 3, 4] as Grade[]) {
            const button = el(this.doc, "button", `ak-button ak-grade ak-grade-${g}`);
            if (g === suggested) button.classList.add("mod-cta");
            button.append(
                el(this.doc, "span", "ak-grade-label", GRADE_LABELS[g]),
                el(this.doc, "span", "ak-grade-interval", formatInterval(preview[g] - now)),
                el(this.doc, "kbd", undefined, String(g)),
            );
            button.addEventListener("click", () => void this.grade(g));
            grades.append(button);
        }
        actions.append(grades);
        this.root.focus();
    }

    /** A typed answer grades itself: wrong → Again, right → Good. The user can still override. */
    private suggestedGrade(): Grade {
        return this.result?.correct === false ? 1 : 3;
    }

    private async grade(grade: Grade): Promise<void> {
        const session = this.session;
        const card = this.current;
        if (!session || !card || !this.result || this.busy) return;
        this.busy = true;
        try {
            if (!card.source.id) {
                const id = await this.backend.ensureId(card);
                if (!id) {
                    this.backend.notify("This card changed in its note, so it was skipped.");
                    session.skip(card);
                    return;
                }
                card.source.id = id;
            }
            const now = Date.now();
            const extra: Partial<ReviewEntry> = { ms: now - this.shownAt };
            if (this.result.typed) extra.ok = this.result.correct === true;
            await this.backend.record(session.grade(card, grade, now, extra));
        } catch (error) {
            console.error("Ankidian: could not save review", error);
            this.backend.notify("Ankidian could not save that review. See the console for details.");
        } finally {
            this.busy = false;
            await this.showNext();
        }
    }

    private async undo(): Promise<void> {
        if (!this.session || this.busy) return;
        const entry = this.session.undo();
        if (!entry) return;
        this.busy = true;
        try {
            await this.backend.unrecord(entry);
        } finally {
            this.busy = false;
            await this.showNext();
        }
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (!this.session || e.metaKey || e.ctrlKey || e.altKey) return;
        const target = e.target as HTMLElement;
        if (target.isContentEditable || target.tagName === "INPUT") return;

        if (e.key === "Escape") {
            this.showDecks();
        } else if (e.key === "u" || e.key === "U") {
            void this.undo();
        } else if (e.key === " " || e.key === "Enter") {
            if (target.tagName === "BUTTON" || target.tagName === "A") return;
            if (!this.current) this.showDecks();
            else if (!this.result) void this.reveal();
            else void this.grade(this.suggestedGrade());
        } else if (this.result && ["1", "2", "3", "4"].includes(e.key)) {
            void this.grade(Number(e.key) as Grade);
        } else {
            return;
        }
        e.preventDefault();
    }
}

function count(doc: Document, n: number, cls: string): HTMLElement {
    return el(doc, "span", `ak-count ${n > 0 ? cls : "ak-zero"}`, String(n));
}

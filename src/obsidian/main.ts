import {
    debounce,
    getAllTags,
    loadPrism,
    Notice,
    Plugin,
    TFile,
    type CachedMetadata,
    type Editor,
} from "obsidian";

import { ensureBlockId } from "../core/block-id";
import { CardIndex, deckFromTags } from "../core/card-index";
import { parseNote } from "../core/parser";
import { ReviewLog } from "../core/review-log";
import { Scheduler } from "../core/scheduler";
import { bucketOf } from "../core/session";
import { DEFAULT_SETTINGS, type Settings } from "../core/settings";
import { cardKey, type Card } from "../core/types";
import type { Backend } from "../ui/app";
import type { RenderEnv } from "../ui/card-view";
import type { PrismLike } from "../ui/live-highlight";
import { AnkidianSettingTab } from "./settings-tab";
import { deviceId, LogStorage } from "./storage";
import { ReviewView, VIEW_TYPE } from "./view";

export default class AnkidianPlugin extends Plugin {
    override settings: Settings = { ...DEFAULT_SETTINGS };
    private scheduler!: Scheduler;
    private log!: ReviewLog;
    private index!: CardIndex;
    private storage!: LogStorage;
    private statusBar: HTMLElement | null = null;
    private prismPromise: Promise<PrismLike | null> | null = null;
    private listeners = new Set<() => void>();

    override async onload(): Promise<void> {
        this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<Settings>) };
        this.scheduler = await Scheduler.create(this.settings);
        this.log = new ReviewLog(this.scheduler);
        this.index = new CardIndex(this.settings);
        this.storage = new LogStorage(this.app, () => this.settings.dataFolder, deviceId(this.app));
        this.index.onChange(() => this.changed());

        this.registerView(VIEW_TYPE, (leaf) => new ReviewView(leaf, this));
        this.addSettingTab(new AnkidianSettingTab(this.app, this));
        this.addRibbonIcon("layers", "Review flashcards", () => void this.openReview());

        this.addCommand({
            id: "review",
            name: "Review flashcards",
            callback: () => void this.openReview(),
        });
        this.addCommand({
            id: "review-note",
            name: "Review cards in this note",
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || !this.index.has(file.path)) return false;
                if (!checking) {
                    void this.openReview().then((view) =>
                        view?.start("", (card) => card.path === file.path),
                    );
                }
                return true;
            },
        });
        this.addCommand({
            id: "cloze-selection",
            name: "Turn selection into a cloze",
            editorCallback: (editor) => this.wrapInCloze(editor),
        });

        this.statusBar = this.addStatusBarItem();
        this.statusBar.addClass("mod-clickable");
        this.registerDomEvent(this.statusBar, "click", () => void this.openReview());
        this.registerInterval(window.setInterval(() => this.updateStatusBar(), 60_000));

        this.app.workspace.onLayoutReady(() => void this.start());
    }

    /** Load review history, index the vault, then keep both current from vault events. */
    private async start(): Promise<void> {
        await this.reloadLog();

        this.registerEvent(
            this.app.metadataCache.on("changed", (file, data, cache) => {
                this.index.setNote(file.path, data, tagsOf(cache));
            }),
        );
        this.registerEvent(this.app.vault.on("delete", (file) => this.index.removeNote(file.path)));
        this.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => this.index.renameNote(oldPath, file.path)),
        );

        // Another device's log arrived through sync.
        const reload = debounce(() => void this.reloadLog(), 1000, true);
        const onLogFile = (file: { path: string }) => {
            if (this.storage.isForeignLog(file.path)) reload();
        };
        this.registerEvent(this.app.vault.on("create", onLogFile));
        this.registerEvent(this.app.vault.on("modify", onLogFile));

        await this.scanVault();
    }

    /** Index every tagged note. Only notes that carry the flashcard tag are read from disk. */
    private async scanVault(): Promise<void> {
        this.index.clear();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache) continue; // not indexed by Obsidian yet; its "changed" event will follow
            const tags = tagsOf(cache);
            if (deckFromTags(tags, this.settings.flashcardTag) === null) continue;
            this.index.setNote(file.path, await this.app.vault.cachedRead(file), tags);
        }
    }

    private async reloadLog(): Promise<void> {
        try {
            this.log.load(await this.storage.loadAll());
        } catch (error) {
            console.error("Ankidian: could not read review logs", error);
            new Notice("Ankidian could not read its review logs. See the console for details.");
        }
        this.changed();
    }

    private readonly changed = debounce(
        () => {
            this.updateStatusBar();
            for (const listener of this.listeners) listener();
        },
        100,
        true,
    );

    private updateStatusBar(): void {
        if (!this.statusBar) return;
        const now = Date.now();
        let due = 0;
        for (const card of this.index.cards()) {
            const bucket = bucketOf(this.log.state(cardKey(card)), now);
            if (bucket === "due" || bucket === "learning") due++;
        }
        this.statusBar.setText(`${due} card${due === 1 ? "" : "s"} due`);
    }

    async updateSettings(patch: Partial<Settings>): Promise<void> {
        const before = this.settings;
        this.settings = { ...before, ...patch };
        await this.saveData(this.settings);

        if (
            before.desiredRetention !== this.settings.desiredRetention ||
            before.maximumIntervalDays !== this.settings.maximumIntervalDays
        ) {
            this.scheduler = await Scheduler.create(this.settings);
            this.log.setScheduler(this.scheduler);
        }
        if (before.dataFolder !== this.settings.dataFolder) this.rescanLogs();
        if (
            before.flashcardTag !== this.settings.flashcardTag ||
            before.highlightClozes !== this.settings.highlightClozes
        ) {
            this.index.setOptions(this.settings);
            this.rescanVault();
        }
        this.changed();
    }

    private readonly rescanVault = debounce(() => void this.scanVault(), 800, true);
    private readonly rescanLogs = debounce(() => void this.reloadLog(), 800, true);

    /** Obsidian's own syntax highlighter, loaded once on first use. */
    prism(): Promise<PrismLike | null> {
        this.prismPromise ??= (loadPrism() as Promise<PrismLike>).catch((error) => {
            console.error("Ankidian: could not load Prism", error);
            return null;
        });
        return this.prismPromise;
    }

    /** What the review UI needs, bound to this vault. */
    backend(env: RenderEnv): Backend {
        const plugin = this;
        return {
            env,
            get settings() {
                return plugin.settings;
            },
            get log() {
                return plugin.log;
            },
            get scheduler() {
                return plugin.scheduler;
            },
            cards: () => this.index.cards(),
            ensureId: (card) => this.ensureId(card),
            record: (entry) => this.storage.append(entry).then(() => this.updateStatusBar()),
            unrecord: (entry) => this.storage.remove(entry).then(() => this.updateStatusBar()),
            openSource: (card) => void this.openSource(card),
            notify: (message) => void new Notice(message),
            onChange: (listener) => {
                this.listeners.add(listener);
                return () => this.listeners.delete(listener);
            },
        };
    }

    /** Write a block ID next to the card the first time it is reviewed. */
    private async ensureId(card: Card): Promise<string | null> {
        const file = this.app.vault.getAbstractFileByPath(card.path);
        if (!(file instanceof TFile)) return null;
        let id: string | null = null;
        await this.app.vault.process(file, (text) => {
            const result = ensureBlockId(text, card.source, this.settings);
            id = result.id;
            return result.text;
        });
        return id;
    }

    private async openSource(card: Card): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(card.path);
        if (!(file instanceof TFile)) return;
        await this.app.workspace
            .getLeaf("tab")
            .openFile(file, { eState: { line: card.source.lineStart } });
    }

    async openReview(): Promise<ReviewView | null> {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (!leaf) {
            leaf = workspace.getLeaf("tab");
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
        }
        await workspace.revealLeaf(leaf);
        return leaf.view instanceof ReviewView ? leaf.view : null;
    }

    /** `{{cN::selection}}`, where N is one more than the highest cloze already in the block. */
    private wrapInCloze(editor: Editor): void {
        const line = editor.getCursor("from").line;
        const block = parseNote(editor.getValue(), this.settings).find(
            (s) => s.kind === "cloze" && line >= s.lineStart && line <= s.lineEnd,
        );
        const used = (block?.subs ?? []).filter((g) => g[0] === "c").map((g) => Number(g.slice(1)));
        const n = used.length ? Math.max(...used) + 1 : 1;
        const selection = editor.getSelection();
        editor.replaceSelection(`{{c${n}::${selection}}}`);
        if (!selection) {
            const cursor = editor.getCursor();
            editor.setCursor({ line: cursor.line, ch: cursor.ch - 2 });
        }
    }
}

function tagsOf(cache: CachedMetadata): string[] {
    return getAllTags(cache) ?? [];
}

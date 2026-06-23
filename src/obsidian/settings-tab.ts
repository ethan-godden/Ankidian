import { PluginSettingTab, Setting, type App } from "obsidian";

import type { Settings, TypedMode } from "../core/settings";
import type AnkidianPlugin from "./main";

export class AnkidianSettingTab extends PluginSettingTab {
    constructor(
        app: App,
        private readonly plugin: AnkidianPlugin,
    ) {
        super(app, plugin);
    }

    override display(): void {
        const { containerEl } = this;
        const { settings } = this.plugin;
        containerEl.empty();

        const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
            this.plugin.updateSettings({ [key]: value } as Pick<Settings, K>);
        const number = (text: string, fallback: number, min: number, max: number) => {
            const n = Number(text);
            return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
        };

        new Setting(containerEl).setName("Cards").setHeading();

        new Setting(containerEl)
            .setName("Flashcard tag")
            .setDesc(
                "Notes with this tag are scanned for cards. Nested tags become decks: #flashcards/python/basics is the deck python/basics.",
            )
            .addText((t) =>
                t
                    .setPlaceholder("flashcards")
                    .setValue(settings.flashcardTag)
                    .onChange((v) => set("flashcardTag", v.trim().replace(/^#/, "") || "flashcards")),
            );

        new Setting(containerEl)
            .setName("Highlights are clozes")
            .setDesc("Treat ==highlighted== text in prose as a cloze deletion. Never applies inside code.")
            .addToggle((t) =>
                t.setValue(settings.highlightClozes).onChange((v) => set("highlightClozes", v)),
            );

        new Setting(containerEl).setName("Typing answers").setHeading();

        new Setting(containerEl)
            .setName("Typed clozes")
            .setDesc("Which cloze deletions you answer by typing instead of revealing.")
            .addDropdown((d) =>
                d
                    .addOptions({
                        always: "All clozes",
                        code: "Only clozes in code blocks",
                        never: "None (reveal only)",
                    })
                    .setValue(settings.typedClozes)
                    .onChange((v) => set("typedClozes", v as TypedMode)),
            );

        new Setting(containerEl)
            .setName("Ignore case in prose")
            .setDesc("Typed prose answers match regardless of capitalisation. Code is always case-sensitive.")
            .addToggle((t) => t.setValue(settings.ignoreCase).onChange((v) => set("ignoreCase", v)));

        new Setting(containerEl)
            .setName("Ignore whitespace differences in code")
            .setDesc("Accept typed code whose spacing or indentation differs from the answer.")
            .addToggle((t) =>
                t
                    .setValue(settings.lenientCodeWhitespace)
                    .onChange((v) => set("lenientCodeWhitespace", v)),
            );

        new Setting(containerEl).setName("Scheduling").setHeading();

        new Setting(containerEl)
            .setName("New cards per day")
            .addText((t) =>
                t
                    .setValue(String(settings.newPerDay))
                    .onChange((v) => set("newPerDay", Math.round(number(v, 20, 0, 9999)))),
            );

        new Setting(containerEl)
            .setName("Desired retention")
            .setDesc(
                "The chance you should still remember a card when it comes due (0.70–0.99). Higher means more reviews. Changing it reschedules every card from its history.",
            )
            .addText((t) =>
                t
                    .setValue(String(settings.desiredRetention))
                    .onChange((v) => set("desiredRetention", number(v, 0.9, 0.7, 0.99))),
            );

        new Setting(containerEl)
            .setName("Maximum interval (days)")
            .addText((t) =>
                t
                    .setValue(String(settings.maximumIntervalDays))
                    .onChange((v) => set("maximumIntervalDays", Math.round(number(v, 36500, 1, 36500)))),
            );

        new Setting(containerEl)
            .setName("Bury siblings")
            .setDesc("After answering a card, hold other cards from the same block until the next session.")
            .addToggle((t) => t.setValue(settings.burySiblings).onChange((v) => set("burySiblings", v)));

        new Setting(containerEl)
            .setName("Day starts at (hour)")
            .setDesc("When the new-card limit resets, 0–23.")
            .addText((t) =>
                t
                    .setValue(String(settings.dayStartHour))
                    .onChange((v) => set("dayStartHour", Math.round(number(v, 4, 0, 23)))),
            );

        new Setting(containerEl).setName("Data").setHeading();

        new Setting(containerEl)
            .setName("Review log folder")
            .setDesc(
                "Vault folder holding one review log per device. If you use Obsidian Sync, turn on syncing of all other file types so the logs travel between devices.",
            )
            .addText((t) =>
                t
                    .setPlaceholder("Ankidian")
                    .setValue(settings.dataFolder)
                    .onChange((v) => set("dataFolder", v.trim().replace(/^\/+|\/+$/g, "") || "Ankidian")),
            );
    }
}

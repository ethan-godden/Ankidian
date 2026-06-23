import { ItemView, MarkdownRenderer, type WorkspaceLeaf } from "obsidian";

import type { Card } from "../core/types";
import { ReviewApp } from "../ui/app";
import type AnkidianPlugin from "./main";

export const VIEW_TYPE = "ankidian-review";

export class ReviewView extends ItemView {
    private reviewApp: ReviewApp | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly plugin: AnkidianPlugin,
    ) {
        super(leaf);
    }

    override getViewType(): string {
        return VIEW_TYPE;
    }

    override getDisplayText(): string {
        return "Ankidian";
    }

    override getIcon(): string {
        return "layers";
    }

    override async onOpen(): Promise<void> {
        const prism = await this.plugin.prism();
        this.contentEl.empty();
        this.reviewApp = new ReviewApp(
            this.contentEl,
            this.plugin.backend({
                prism,
                // Rendering is owned by this view, so everything it creates is cleaned up on close.
                renderMarkdown: (markdown, target, sourcePath) => {
                    target.addClass("markdown-rendered");
                    return MarkdownRenderer.render(this.app, markdown, target, sourcePath, this);
                },
            }),
        );

        // Make [[links]] inside cards work.
        this.registerDomEvent(this.contentEl, "click", (event) => {
            const link = (event.target as HTMLElement).closest("a.internal-link");
            const href = link?.getAttribute("data-href") ?? link?.getAttribute("href");
            if (!link || !href) return;
            event.preventDefault();
            void this.app.workspace.openLinkText(href, "", "tab");
        });
    }

    override async onClose(): Promise<void> {
        this.reviewApp?.destroy();
        this.reviewApp = null;
    }

    start(deck: string, filter?: (card: Card) => boolean): void {
        this.reviewApp?.start(deck, filter);
    }
}

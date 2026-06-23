import { normalizePath, type App } from "obsidian";

import { parseLog, serializeEntry } from "../core/review-log";
import type { ReviewEntry } from "../core/scheduler";

const DEVICE_KEY = "ankidian-device-id";

/** A stable ID for this installation, kept outside the vault so it never syncs. */
export function deviceId(app: App): string {
    let id = app.loadLocalStorage(DEVICE_KEY) as string | null;
    if (!id) {
        id = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
        app.saveLocalStorage(DEVICE_KEY, id);
    }
    return id;
}

/**
 * Review logs on disk: one append-only JSON-lines file per device, in a vault folder.
 *
 * A device only ever writes its own file, so file-sync tools never see two devices editing
 * the same file, and merging is just reading every file in the folder.
 */
export class LogStorage {
    private own: ReviewEntry[] = [];
    private queue: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly app: App,
        private readonly folder: () => string,
        private readonly device: string,
    ) {}

    private get dir(): string {
        return normalizePath(this.folder() || "Ankidian");
    }

    get ownPath(): string {
        return normalizePath(`${this.dir}/reviews-${this.device}.jsonl`);
    }

    /** Is this vault path one of the review logs written by another device? */
    isForeignLog(path: string): boolean {
        return (
            path !== this.ownPath &&
            path.startsWith(this.dir + "/") &&
            /\/reviews-[^/]+\.jsonl$/.test(path)
        );
    }

    /** Read every device's log. */
    async loadAll(): Promise<ReviewEntry[][]> {
        await this.queue;
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(this.dir))) {
            this.own = [];
            return [];
        }
        const logs: ReviewEntry[][] = [];
        const { files } = await adapter.list(this.dir);
        for (const path of files) {
            if (!/\/reviews-[^/]+\.jsonl$/.test(path)) continue;
            const entries = parseLog(await adapter.read(path));
            if (normalizePath(path) === this.ownPath) this.own = entries;
            logs.push(entries);
        }
        return logs;
    }

    append(entry: ReviewEntry): Promise<void> {
        return this.enqueue(async () => {
            const adapter = this.app.vault.adapter;
            if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
            await adapter.append(this.ownPath, serializeEntry(entry));
            this.own.push(entry);
        });
    }

    /** Remove an entry this device wrote (undo). */
    remove(entry: ReviewEntry): Promise<void> {
        return this.enqueue(async () => {
            const at = this.own.findIndex(
                (e) => e.k === entry.k && e.t === entry.t && e.r === entry.r,
            );
            if (at < 0) return;
            this.own.splice(at, 1);
            await this.app.vault.adapter.write(this.ownPath, this.own.map(serializeEntry).join(""));
        });
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        const next = this.queue.then(task, task);
        this.queue = next.catch(() => undefined);
        return next;
    }
}

/**
 * Runs Ankidian's real review UI in a plain browser tab, with an in-memory vault.
 * Nothing here ships in the plugin; it exists to develop and test the UI without Obsidian.
 */
import { marked } from "marked";
import Prism from "prismjs";
import "prismjs/components/prism-python";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-bash";

import { ensureBlockId } from "../src/core/block-id";
import { CardIndex } from "../src/core/card-index";
import { ReviewLog } from "../src/core/review-log";
import { Scheduler } from "../src/core/scheduler";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { ReviewApp, type Backend } from "../src/ui/app";
import type { PrismLike } from "../src/ui/live-highlight";

const F = "```";
const notes: Record<string, { tags: string[]; text: string }> = {
    "Python.md": {
        tags: ["#flashcards/code/python"],
        text: `# Python

## Recursion

Complete the Fibonacci function:
${F}python
def fib(n):
    if n < 2:
        return {{c1::n}}
    return {{c2::fib(n - 1) + fib(n - 2)}}
${F}

## Loops

Sum the even numbers, writing the whole loop body:
${F}python
def sum_even(xs):
    total = 0
    for x in xs:
        {{c1::if x % 2 == 0:
            total += x}}
    return total
${F}

## Strings

Use an f-string:
${F}python
name = "Ada"
print({{c1::f"Hello, {name}!"}})
${F}
`,
    },
    "TypeScript.md": {
        tags: ["#flashcards/code/typescript"],
        text: `# TypeScript

A generic identity function:
${F}ts
function identity{{c1::<T>}}(value: {{c1::T}}): {{c1::T}} {
    return value;
}
${F}
`,
    },
    "Geography.md": {
        tags: ["#flashcards/geography"],
        text: `# Geography

The capital of **{{c1::France::country}}** is *{{c2::Paris}}*.

The longest river in Africa is the ==Nile==.

- Capital of Kenya::Nairobi
- Largest ocean:::Pacific

What does this print?
?
${F}python
print("It prints the answer.")
${F}
`,
    },
};

async function main() {
    const settings = { ...DEFAULT_SETTINGS };
    const scheduler = await Scheduler.create(settings);
    const log = new ReviewLog(scheduler);
    const index = new CardIndex(settings);
    for (const [path, note] of Object.entries(notes)) index.setNote(path, note.text, note.tags);

    const backend: Backend = {
        settings,
        log,
        scheduler,
        env: {
            prism: Prism as unknown as PrismLike,
            async renderMarkdown(markdown, target) {
                target.innerHTML = await marked.parse(markdown);
            },
        },
        cards: () => index.cards(),
        async ensureId(card) {
            const note = notes[card.path];
            const result = ensureBlockId(note.text, card.source, settings);
            if (result.id && result.text !== note.text) {
                note.text = result.text;
                index.setNote(card.path, note.text, note.tags);
            }
            return result.id;
        },
        async record() {},
        async unrecord() {},
        openSource: (card) => alert(`${card.path}\n\n${notes[card.path].text}`),
        notify: (message) => console.warn(message),
        onChange: (listener) => index.onChange(listener),
    };

    const app = new ReviewApp(document.getElementById("app")!, backend);
    Object.assign(window, { ankidian: { app, backend, index, log, notes } });
}

void main();

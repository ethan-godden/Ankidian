# Design

This records what Ankidian does differently from [obsidian-spaced-repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) (OSR) and why. The OSR observations are from reading its source at commit `298c19f` (v1.15.4).

## What OSR does, and where it strains

| Area | OSR | Consequence |
| --- | --- | --- |
| Typed clozes | An `<input type="text">` HTML string is spliced into the card's Markdown before rendering (`question-type.ts`). | HTML is literal inside a fenced block, so it cannot work in code. Single line only. Sized to the answer's length, which leaks the answer. |
| Clozes in code | The parser consumes a whole fenced block before it checks a line for clozes (`parser.ts`). | A cloze inside a code block is never detected. |
| Checking | `input.value.trim() === answer.innerText.trim()`, found with `activeDocument.querySelectorAll` (`card-container.tsx`). | No tolerance options, no diff, hard-coded green/red, and the lookup is document-wide rather than scoped to the card. |
| Schedule storage | An `<!--SR:…-->` comment next to each card, rewritten on every review. | Every review edits a note: sync conflicts, noisy git history, cluttered source. A sidecar store was tried and shelved (`data-store/WIP_DataStores.zip`). |
| Card identity | Position in the note plus a text hash; a `TODO: Replace question hash with a blockid` remains. | Adding or removing a sibling cloze shifts schedules onto the wrong cards. |
| History | Only the current interval/ease or FSRS state is kept; I found no review log. | No real undo, no statistics from history, parameters cannot be re-fitted, a changed setting cannot be re-applied to the past. |
| Indexing | `sync()` walks every Markdown file and is called from seven places. | Cost grows with vault size on each open, status refresh and reminder tick. |
| Structure | 27 `getInstance()` calls in 14 files; `DataStore.instance` and `SRAlgorithm.instance` are mutable globals; `initUnitTestCore` duplicates `init` for tests. | Hard to test in isolation; tests need Obsidian mocks. |
| Parser | Line-based with user-configurable separators. The HTML-comment skip loop tests a variable it never updates, so a multi-line comment appears to swallow the rest of the note. | Edge cases are hard to reason about. |
| Size | About 25k lines; ships chart.js, gridjs, pagerank.js, moment, vhtml. | Large surface for a small team. |

## What Ankidian does instead

### 1. Render the whole answer, then cut the blank out

The card is rendered with every answer filled in: prose through Obsidian's Markdown renderer, code through Prism. Only then are the active answers removed from the rendered DOM and replaced with blanks (`src/ui/card-view.ts`).

- Markdown and the syntax highlighter always see complete, valid text, so formatting and colours around a blank are right.
- The removed fragment *is* the formatted answer. Reveal puts it back; nothing is rendered twice.
- Prose answers are located by private-use marker characters that pass through Markdown; code answers by character offset, so the highlighter's input is untouched.

### 2. Blanks are inline plain-text editables

A blank is a `contenteditable="plaintext-only"` span (`src/ui/typed-input.ts`). It inherits font, weight and colour from its position, grows as you type, and wraps across lines inside `<pre>`.

Typed code is coloured with the CSS Custom Highlight API (`src/ui/live-highlight.ts`): the whole block, including what has been typed, is tokenised and colour ranges are painted over the blank without changing its DOM. The caret, IME composition and native undo keep working, which they would not if the text were re-wrapped in spans on every keystroke.

### 3. Scheduling state is derived, never stored

The only persisted scheduling data is the review log: `{card, time, grade}` per review, appended to one JSON-lines file per device (`src/obsidian/storage.ts`). A card's state is a fold of its entries through FSRS (`src/core/review-log.ts`).

- Sync is a set union of logs. Two devices cannot conflict, because each writes only its own file.
- Undo is deleting a log entry.
- Changing desired retention re-derives every card from its history.
- Reviews never touch notes.

### 4. Stable identity from block IDs, written lazily

A card block gets `^ak-xxxxxx` the first time it is reviewed, not when it is first seen, so unreviewed notes are never modified. Siblings are keyed `id:c1`, `id:c2`, so editing one cloze cannot disturb another's schedule. The ID is inserted by locating the card by content inside `vault.process`, so a note edited mid-review is handled (`src/core/block-id.ts`).

### 5. Incremental index

Cards are indexed per note from `metadataCache.on("changed")`, which already supplies the file's text. Startup reads only notes that carry the flashcard tag. Nothing rescans the vault during use (`src/core/card-index.ts`, `src/obsidian/main.ts`).

### 6. A core with no Obsidian in it

```
src/core/      parser, cloze model, comparison, scheduler, review log, session   (pure TypeScript)
src/ui/        card renderer, blanks, review screens                             (DOM only)
src/obsidian/  plugin entry, vault indexing, storage, settings                   (Obsidian API)
```

`core` and `ui` do not import `obsidian`. The UI talks to a `Backend` interface, so the unit tests need no mocks and `demo/` runs the real review UI in a browser tab.

## Known limits

- Not yet exercised inside Obsidian itself; verified through unit tests and the browser demo.
- A cloze answer with unbalanced braces followed by another cloze on the same line falls back to the first `}}`.
- Cloze syntax is shown raw in reading view and live preview; there is no editor decoration yet.
- Each `front::back` line needs its own block ID, which renders as text in reading view when several such lines share one paragraph. List items avoid this.
- Whole-note review, statistics, reminders and localisation from OSR are not implemented.
- Basic cards are reveal-only; only clozes are typed.

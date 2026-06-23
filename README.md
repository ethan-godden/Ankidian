# Ankidian

Spaced repetition for Obsidian where you **type** cloze answers in place, including inside code blocks, and what you type is formatted like the text it replaces.

- A blank inside a fenced code block is monospace, sits inline in the code, is syntax-coloured as you type, auto-indents, and can span several lines.
- A blank inside prose inherits the surrounding formatting (bold, italic, inline code).
- On reveal, the correct answer goes back in with its formatting, and a character diff shows what you got wrong.

Status: early (0.1.0). The core and the review UI are tested; see [docs/DESIGN.md](docs/DESIGN.md) for what is and is not done.

## Writing cards

Tag a note `#flashcards`. Nested tags become decks: `#flashcards/python/basics` is the deck `python/basics`.

A card is a block of text: a run of lines with no blank line in it. A fenced code block always stays in one piece, and a line directly above it (no blank line between) is its prompt.

### Cloze deletions

````markdown
The capital of {{c1::France::country}} is {{c2::Paris}}.

The longest river in Africa is the ==Nile==.

Complete the function:
```python
def fib(n):
    if n < 2:
        return {{c1::n}}
    return {{c2::fib(n - 1) + fib(n - 2)}}
```
````

- `{{c1::answer}}` works everywhere. Clozes with the same number are asked together; each different number is its own card.
- `{{c1::answer::hint}}` adds a hint, in prose only. Inside code `::` is left alone so `{{c1::std::vector<int>}}` is one answer.
- `==answer==` is a cloze in prose only (it would collide with `a == b` in code). Each highlight is its own card. This can be turned off.
- Answers in code may contain braces (`{{c1::{ a: { b: 1 } }}}`) and may span lines.

The command **Turn selection into a cloze** wraps the selection with the next free number.

### Basic cards

```markdown
- Capital of Kenya::Nairobi
- Largest ocean:::Pacific

What does a list comprehension look like?
?
[x * 2 for x in xs]
```

`::` is front/back, `:::` also makes the reversed card. A line holding only `?` (or `??` for reversed) splits a multi-line card.

## Reviewing

Open **Review flashcards** from the ribbon, the status bar, or the command palette.

| Key | Action |
| --- | --- |
| Enter | In a single-line blank: next blank, or check the card |
| Ctrl/⌘+Enter | Check the card from any blank |
| Enter, Tab | In a multi-line code blank: new line with indentation, indent |
| Space | Show the answer, then accept the suggested grade |
| 1 2 3 4 | Again, Hard, Good, Easy |
| U | Undo the last grade |
| Esc | Leave a blank, or go back to the decks |

A typed answer suggests its own grade (wrong: Again, right: Good); you can always pick another.

## Where your data lives

- **Notes** get one block ID (`^ak-x1y2z3`) per card block, written the first time you review it. Nothing else is ever written to a note.
- **Reviews** are appended to `Ankidian/reviews-<device>.jsonl` in the vault, one file per device. Card schedules are recomputed from these logs with FSRS, so devices that have synced the same logs always agree. With Obsidian Sync, enable syncing of "all other file types".

## Development

```bash
npm install
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run demo
```

`npm run demo` bundles a browser harness that runs the real review UI against an in-memory vault. Serve the repo root (`python3 -m http.server 4173`) and open `/demo/index.html`.

`dev-vault/` is a sample vault with the built plugin symlinked in; open it in Obsidian and enable community plugins to try it.

## Credits

Inspired by [obsidian-spaced-repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition). Scheduling by [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs).

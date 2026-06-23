import { beforeAll, describe, expect, it } from "vitest";

import { ensureBlockId } from "../src/core/block-id";
import { CardIndex, deckFromTags } from "../src/core/card-index";
import { buildClozeView, MARK_CLOSE, MARK_OPEN } from "../src/core/cloze-view";
import { diffChars, isCorrect } from "../src/core/compare";
import { parseNote } from "../src/core/parser";
import { parseLog, ReviewLog, serializeEntry } from "../src/core/review-log";
import { formatInterval, Scheduler } from "../src/core/scheduler";
import { dayStart, deckRows, Session } from "../src/core/session";
import type { FenceView, ProseView } from "../src/core/cloze-view";

const opts = { highlightClozes: true };
const parse = (text: string) => parseNote(text, opts);

describe("parser: prose clozes", () => {
    it("reads anki-style clozes with hints", () => {
        const [s] = parse("The capital of {{c1::France::country}} is {{c2::Paris}}.");
        expect(s.kind).toBe("cloze");
        expect(s.subs).toEqual(["c1", "c2"]);
        expect(s.clozes.map((c) => [c.answer, c.hint])).toEqual([
            ["France", "country"],
            ["Paris", undefined],
        ]);
    });

    it("groups clozes that share a number", () => {
        const [s] = parse("{{c1::a}} and {{c1::b}} then {{c2::c}}");
        expect(s.subs).toEqual(["c1", "c2"]);
    });

    it("treats highlights as separate clozes", () => {
        const [s] = parse("Water is ==H2O== and salt is ==NaCl==.");
        expect(s.subs).toEqual(["h1", "h2"]);
        expect(s.clozes.map((c) => c.answer)).toEqual(["H2O", "NaCl"]);
    });

    it("can turn highlight clozes off", () => {
        expect(parseNote("Water is ==H2O==.", { highlightClozes: false })).toEqual([]);
    });

    it("ignores == inside inline code and comparisons", () => {
        expect(parse("Use `a == b` or a == b == c here")).toEqual([]);
    });

    it("keeps :: inside inline code out of the hint", () => {
        const [s] = parse("Call {{c1::`std::move`::cast}} here");
        expect(s.clozes[0].answer).toBe("`std::move`");
        expect(s.clozes[0].hint).toBe("cast");
    });

    it("skips frontmatter and tracks headings", () => {
        const [s] = parse("---\ntags: [flashcards]\n---\n# Geo\n## Europe\n\n==Paris== is nice");
        expect(s.headings).toEqual(["Geo", "Europe"]);
        expect(s.lineStart).toBe(6);
    });
});

describe("parser: code clozes", () => {
    const note = [
        "Complete the function:",
        "```python",
        "def fib(n):",
        "    if n < 2:",
        "        return {{c1::n}}",
        "    return {{c2::fib(n - 1) + fib(n - 2)}}",
        "```",
    ].join("\n");

    it("finds clozes inside a fenced block and keeps the prompt attached", () => {
        const [s] = parse(note);
        expect(s.subs).toEqual(["c1", "c2"]);
        expect(s.segments.map((x) => x.type)).toEqual(["prose", "fence"]);
        const fence = s.segments[1];
        expect(fence.type === "fence" && fence.lang).toBe("python");
    });

    it("does not read hints or highlights inside code", () => {
        const [s] = parse("```cpp\nauto v = {{c1::std::vector<int>{}}};\nif (a ==b== c) {}\n```");
        expect(s.clozes).toHaveLength(1);
        expect(s.clozes[0].answer).toBe("std::vector<int>{}");
        expect(s.clozes[0].hint).toBeUndefined();
    });

    it("balances braces in answers", () => {
        const [s] = parse('```js\nconst x = {{c1::{ a: { b: 1 } }}};\n```');
        expect(s.clozes[0].answer).toBe("{ a: { b: 1 } }");
    });

    it("falls back when braces are unbalanced", () => {
        const [s] = parse("```js\nif (x) {{c1::{}} y {{c2::z}}\n```");
        expect(s.clozes.map((c) => c.answer)).toEqual(["{", "z"]);
    });

    it("supports multi-line answers and blank lines inside the fence", () => {
        const [s] = parse("```py\nfor x in xs:\n    {{c1::total += x\n\n    count += 1}}\n```");
        expect(s.clozes[0].answer).toBe("total += x\n\n    count += 1");
    });

    it("leaves fenced code without clozes alone", () => {
        expect(parse("```js\nconst a = b::c;\n```")).toEqual([]);
    });
});

describe("parser: basic cards", () => {
    it("reads single-line cards, one per line", () => {
        const s = parse("- Capital of Kenya::Nairobi\n- 2 + 2:::4 ^ak-abc123");
        expect(s).toHaveLength(2);
        expect([s[0].front, s[0].back, s[0].subs]).toEqual(["Capital of Kenya", "Nairobi", ["f"]]);
        expect([s[1].front, s[1].back, s[1].subs, s[1].id]).toEqual([
            "2 + 2",
            "4",
            ["f", "r"],
            "ak-abc123",
        ]);
    });

    it("reads multi-line cards with code in the answer", () => {
        const [s] = parse("How do you loop?\n?\n```py\nfor x in xs:\n    pass\n```\n\n^ak-zzzz99");
        expect(s.kind).toBe("basic");
        expect(s.front).toBe("How do you loop?");
        expect(s.back).toContain("for x in xs:");
        expect(s.id).toBe("ak-zzzz99");
        expect(s.lineEnd).toBe(7);
    });

    it("ignores :: in inline code", () => {
        expect(parse("Use `a::b` often")).toEqual([]);
    });
});

describe("block ids", () => {
    it("reads an id at the end of a paragraph", () => {
        const [s] = parse("==Paris== is the capital ^ak-par1s0");
        expect(s.id).toBe("ak-par1s0");
        expect(s.body).toBe("==Paris== is the capital");
    });

    it("appends an id to a paragraph card", () => {
        const text = "intro\n\n==Paris== is the capital\n\nother";
        const [s] = parse(text).filter((x) => x.body.includes("Paris"));
        const r = ensureBlockId(text, s, opts, () => "ak-000001");
        expect(r.id).toBe("ak-000001");
        expect(r.text).toBe("intro\n\n==Paris== is the capital ^ak-000001\n\nother");
        expect(parse(r.text)[0].id).toBe("ak-000001");
    });

    it("puts the id on its own line after a code block", () => {
        const text = "```py\nx = {{c1::1}}\n```\n\nnext paragraph";
        const [s] = parse(text);
        const r = ensureBlockId(text, s, opts, () => "ak-000002");
        expect(r.text).toBe("```py\nx = {{c1::1}}\n```\n\n^ak-000002\n\nnext paragraph");
        const again = parse(r.text);
        expect(again[0].id).toBe("ak-000002");
        expect(again[0].body).toBe(s.body);
    });

    it("reuses an existing id and finds moved cards by content", () => {
        const text = "new line\n\nmore\n\n==Paris== rocks ^ak-keep00";
        const r = ensureBlockId(text, { body: "==Paris== rocks", lineStart: 0 }, opts);
        expect(r).toEqual({ text, id: "ak-keep00" });
        expect(ensureBlockId(text, { body: "gone", lineStart: 0 }, opts).id).toBeNull();
    });
});

describe("cloze view", () => {
    it("fills in code answers and reports their ranges", () => {
        const [s] = parse("```py\nreturn {{c1::a}} + {{c2::bb}}\n```");
        const [fence] = buildClozeView(s, "c2") as FenceView[];
        expect(fence.code).toBe("return a + bb");
        expect(fence.clozes.map((c) => [fence.code.slice(c.start, c.end), c.active])).toEqual([
            ["a", false],
            ["bb", true],
        ]);
    });

    it("brackets prose answers with markers", () => {
        const [s] = parse("**{{c1::Bold}}** and ==hl==");
        const [prose] = buildClozeView(s, "c1") as ProseView[];
        expect(prose.markdown).toBe(
            `**${MARK_OPEN}Bold${MARK_CLOSE}** and ${MARK_OPEN}hl${MARK_CLOSE}`,
        );
        expect(prose.clozes.map((c) => c.active)).toEqual([true, false]);
    });
});

describe("compare", () => {
    const code = { code: true, ignoreCase: true, lenientCodeWhitespace: false };
    const prose = { code: false, ignoreCase: true, lenientCodeWhitespace: false };

    it("is loose for prose and strict for code", () => {
        expect(isCorrect("  paris ", "Paris", prose)).toBe(true);
        expect(isCorrect("paris", "Paris", { ...prose, ignoreCase: false })).toBe(false);
        expect(isCorrect("Return x", "return x", code)).toBe(false);
        expect(isCorrect("return x  \n", "return x", code)).toBe(true);
    });

    it("keeps indentation significant in code unless lenient", () => {
        expect(isCorrect("a\n  b", "a\n    b", code)).toBe(false);
        expect(isCorrect("a\n  b", "a\n    b", { ...code, lenientCodeWhitespace: true })).toBe(true);
    });

    it("diffs characters", () => {
        expect(diffChars("fib(n-1)", "fib(n - 1)")).toEqual([
            { op: "eq", text: "fib(n" },
            { op: "ins", text: " " },
            { op: "eq", text: "-" },
            { op: "ins", text: " " },
            { op: "eq", text: "1)" },
        ]);
        expect(diffChars("", "abc")).toEqual([{ op: "ins", text: "abc" }]);
    });
});

describe("decks and index", () => {
    it("derives decks from tags", () => {
        expect(deckFromTags(["#other"], "flashcards")).toBeNull();
        expect(deckFromTags(["#flashcards"], "flashcards")).toBe("Default");
        expect(deckFromTags(["#flashcards", "#Flashcards/py/basics"], "#flashcards")).toBe(
            "py/basics",
        );
    });

    it("indexes notes incrementally", () => {
        const index = new CardIndex({ ...opts, flashcardTag: "flashcards" });
        let changes = 0;
        index.onChange(() => changes++);
        index.setNote("a.md", "{{c1::x}} and {{c2::y}}", ["#flashcards/a"]);
        index.setNote("b.md", "q::a", ["#nope"]);
        expect(index.cards().map((c) => `${c.path}:${c.deck}:${c.sub}`)).toEqual([
            "a.md:a:c1",
            "a.md:a:c2",
        ]);
        index.renameNote("a.md", "c.md");
        index.setNote("c.md", "no cards now", ["#flashcards/a"]);
        expect(index.cards()).toEqual([]);
        expect(changes).toBe(3);
    });
});

describe("scheduling", () => {
    let scheduler: Scheduler;
    beforeAll(async () => {
        scheduler = await Scheduler.create({ desiredRetention: 0.9, maximumIntervalDays: 36500 });
    });
    const T0 = new Date("2026-01-10T12:00:00").getTime();
    const DAY = 86_400_000;

    it("derives the same state from the same entries in any load order", () => {
        const a = [
            { k: "ak-1:c1", t: T0, r: 3 as const },
            { k: "ak-1:c1", t: T0 + 5 * DAY, r: 3 as const },
        ];
        const b = [{ k: "ak-1:c1", t: T0 + 40 * DAY, r: 1 as const }];
        const one = new ReviewLog(scheduler);
        one.load([a, b]);
        const two = new ReviewLog(scheduler);
        two.load([b, a, a]);
        expect(one.size).toBe(3);
        expect(two.size).toBe(3);
        expect(two.state("ak-1:c1")!.due).toBe(one.state("ak-1:c1")!.due);
        expect(one.state("ak-1:c1")!.lapses).toBe(1);
        expect(one.state("ak-none:c1")).toBeNull();
    });

    it("orders grade previews", () => {
        const p = scheduler.preview(null, T0);
        expect(p[1]).toBeLessThanOrEqual(p[2]);
        expect(p[2]).toBeLessThanOrEqual(p[3]);
        expect(p[3]).toBeLessThan(p[4]);
    });

    it("round-trips the log format and survives junk lines", () => {
        const e = { k: "ak-1:c1", t: T0, r: 3 as const, ok: true };
        expect(parseLog(serializeEntry(e) + "{broken\n\n" + '{"k":1}\n')).toEqual([e]);
    });

    it("runs a session with new-card limits, sibling burying, relearning and undo", () => {
        const index = new CardIndex({ ...opts, flashcardTag: "flashcards" });
        index.setNote(
            "n.md",
            "{{c1::a}} {{c2::b}} ^ak-aaaaaa\n\nq1::a1 ^ak-bbbbbb\n\nq2::a2 ^ak-cccccc",
            ["#flashcards/x/y"],
        );
        const log = new ReviewLog(scheduler);
        const cards = index.cards();
        expect(deckRows(cards, log, T0).map((r) => [r.deck, r.depth, r.counts.new])).toEqual([
            ["x", 0, 4],
            ["x/y", 1, 4],
        ]);

        const session = new Session(cards, log, T0, { newRemaining: 2, burySiblings: true });
        expect(session.remaining).toBe(2); // c1 (c2 buried), q1; q2 is over the limit

        const first = session.current(T0)!;
        expect(first.sub).toBe("c1");
        session.grade(first, 1, T0); // Again → comes back in this session
        expect(session.remaining).toBe(2);
        expect(session.current(T0)!.source.front).toBe("q1");

        session.grade(session.current(T0)!, 4, T0 + 1000);
        expect(session.current(T0 + 2000)).toBe(first); // only the learning card is left
        expect(log.introducedSince(dayStart(T0, 4))).toBe(2);

        session.undo();
        expect(session.current(T0)!.source.front).toBe("q1");
        expect(log.state("ak-bbbbbb:f")).toBeNull();
        expect(session.done).toBe(1);
    });

    it("formats intervals", () => {
        expect(
            [30_000, 600_000, 3 * 3_600_000, 4 * DAY, 75 * DAY, 500 * DAY].map(formatInterval),
        ).toEqual(["<1m", "10m", "3h", "4d", "2.5mo", "1.4y"]);
    });
});

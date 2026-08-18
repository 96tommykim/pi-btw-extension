import assert from "node:assert";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { BtwThreadView } from "../lib/thread-view.ts";
import type { BtwEntry, BtwThread } from "../lib/threads.ts";

const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const UP = "\x1b[A";
const DOWN = "\x1b[B";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function makeCallbacks() {
  return {
    onSubmit: () => {},
    onNew: () => {},
    onList: () => {},
    onClose: () => {},
    onPromote: () => {},
    onPromoteSelected: (_id: string) => {},
    onPromoteAll: () => {},
    onRefineSelected: (_id: string) => {},
  };
}

const callbacks = makeCallbacks();

function entry(id: string, question: string, answer: string): BtwEntry {
  return {
    id,
    mode: "quick",
    question,
    answer,
    grounding: { capturedAt: "", model: "", contextInfo: "" },
  };
}

function createView(entries: BtwEntry[], rows = 40, cb: typeof callbacks = callbacks): BtwThreadView {
  const tui = {
    terminal: { rows },
    requestRender: () => {},
  } as unknown as TUI;
  const view = new BtwThreadView(tui, theme, cb);
  const thread: BtwThread = { id: "t1", createdAt: "", entries };
  view.setThread(thread);
  return view;
}

function render(entries: BtwEntry[], width = 60, rows = 40): string[] {
  return createView(entries, rows).render(width);
}

function plain(lines: string[]): string {
  return stripTerminalSequences(lines.join("\n"));
}

function linesWithinWidth(lines: string[], width: number): boolean {
  return lines.every((line) => visibleWidth(line) <= width);
}

test("shows only the last card's exchange, with a 2/2 title", () => {
  const lines = plain(
    render([entry("e1", "first question", "first answer"), entry("e2", "second question", "second answer")]),
  ).split("\n");

  assert.ok(lines.some((line) => line.includes("2/2")));
  assert.ok(lines.some((line) => line.includes("second question")));
  assert.ok(lines.some((line) => line.includes("second answer")));
  assert.ok(!lines.some((line) => line.includes("first question")));
  assert.ok(!lines.some((line) => line.includes("first answer")));
});

test("left/right move between cards when the input is empty, clamped at the edges", () => {
  const view = createView([entry("e1", "first question", "first answer"), entry("e2", "second question", "second answer")]);

  let out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("2/2")));

  view.handleInput(LEFT);
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("1/2")));
  assert.ok(out.some((line) => line.includes("first question")));

  view.handleInput(LEFT); // clamp at the first card
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("1/2")));

  view.handleInput(RIGHT);
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("2/2")));
  assert.ok(out.some((line) => line.includes("second question")));
});

test("left does not change cards while the input has text", () => {
  const view = createView([entry("e1", "first question", "first answer"), entry("e2", "second question", "second answer")]);
  view.handleInput("h"); // type into the input; left/right now belong to it

  view.handleInput(LEFT);
  const out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("2/2")));
  assert.ok(out.some((line) => line.includes("second question")));
});

test("PgUp/PgDn move cards regardless of input contents", () => {
  const view = createView([entry("e1", "first question", "first answer"), entry("e2", "second question", "second answer")]);
  view.handleInput("h"); // non-empty input should not block paging

  view.handleInput("\x1b[5~"); // pageUp
  let out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("1/2")));

  view.handleInput("\x1b[6~"); // pageDown
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("2/2")));
});

test("a long answer under a small viewport shows scroll indicators and stays within width", () => {
  const longAnswer = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  // rows=18 leaves a content budget >= 3 (bodyBudget 10 - header 3 = 7) so the
  // scroll indicators have room to appear alongside the pinned header.
  const view = createView([entry("e1", "q", longAnswer)], 18);

  let raw = view.render(50);
  let out = plain(raw).split("\n");
  assert.ok(out.some((line) => line.includes("↓ more")));
  assert.ok(!out.some((line) => line.includes("↑ more")));
  assert.ok(linesWithinWidth(raw, 50));

  view.handleInput(DOWN);
  raw = view.render(50);
  out = plain(raw).split("\n");
  assert.ok(out.some((line) => line.includes("↑ more")));
  assert.ok(linesWithinWidth(raw, 50));
});

test("a card whose content exactly fills the budget shows no scroll indicator and reveals the last line", () => {
  // rows=18 -> viewport 12 -> bodyBudget 10; header is 3 lines (top pad,
  // title, bottom pad) at this width, leaving a content budget of 7. A
  // 3-line answer produces exactly 7 content rows (YOU, question, blank,
  // BTW, 3 answer lines) -- no truncation, so no "↓ more" and the last
  // answer line ("line 2") must be visible.
  const answer = Array.from({ length: 3 }, (_, i) => `line ${i}`).join("\n");
  const out = plain(render([entry("e1", "q", answer)], 50, 18)).split("\n");
  assert.ok(!out.some((line) => line.includes("↓ more")));
  assert.ok(out.some((line) => line.includes("line 2")));
});

test("tiny viewports (rows 9/10/11): the selected-card marker stays visible in select mode", () => {
  for (const rows of [9, 10, 11]) {
    const entries = [entry("e1", "q1", "a1"), entry("e2", "q2", "a2")];
    const view = createView(entries, rows);
    view.enterSelect(["e1", "e2"]);
    const out = plain(view.render(60)).split("\n");
    assert.ok(out.some((line) => line.includes("▸ YOU")), `rows=${rows}`);
  }
});

test("setThread on the same thread: cursor jumps to the new last entry only when the pending card was being watched, stays put otherwise", () => {
  const tui = { terminal: { rows: 40 }, requestRender: () => {} } as unknown as TUI;
  const view = new BtwThreadView(tui, theme, callbacks);
  const entries = [entry("e1", "q1", "a1"), entry("e2", "q2", "a2")];
  view.setThread({ id: "t1", createdAt: "", entries });

  // Same thread id, same length (e.g. a promoted flag flipped): cursor stays,
  // and it's still on the last card (2/2) at this point.
  const sameLenEntries = [{ ...entries[0] }, { ...entries[1], promoted: true }];
  view.setThread({ id: "t1", createdAt: "", entries: sameLenEntries });
  let out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("2/2")));

  // A third question goes out: setBusy moves the cursor onto the pending card
  // (index == entries.length == 2).
  view.setBusy(true, "asking…", "q3");
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("3/3"))); // 2 entries + pending card

  // Same thread id, the answer lands (entries grew from 2 to 3) while the
  // cursor was on the pending card: cursor jumps to (lands on) the new last entry.
  const grownEntries = [...sameLenEntries, entry("e3", "q3", "a3")];
  view.setBusy(false);
  view.setThread({ id: "t1", createdAt: "", entries: grownEntries });
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("3/3")));
  assert.ok(out.some((line) => line.includes("q3")));
});

test("setThread on the same thread: cursor does not jump when the user was reading an earlier card as entries grow", () => {
  const tui = { terminal: { rows: 40 }, requestRender: () => {} } as unknown as TUI;
  const view = new BtwThreadView(tui, theme, callbacks);
  const entries = [entry("e1", "q1", "a1"), entry("e2", "q2", "a2")];
  view.setThread({ id: "t1", createdAt: "", entries });

  view.handleInput(LEFT); // move to card 1/2
  let out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("1/2")));

  // Same thread id, entries grew to 3: since the user was reading card 1 (not
  // the last/pending card), the cursor must stay put instead of jumping.
  const grownEntries = [...entries, entry("e3", "q3", "a3")];
  view.setThread({ id: "t1", createdAt: "", entries: grownEntries });
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("1/3")));
  assert.ok(!out.some((line) => line.includes("q3")));
});

test("setThread on a different thread hides (but does not clear) a stale busy/pending state", () => {
  const tui = { terminal: { rows: 40 }, requestRender: () => {} } as unknown as TUI;
  const view = new BtwThreadView(tui, theme, callbacks);
  view.setThread({ id: "t1", createdAt: "", entries: [entry("e1", "q1", "a1")] });
  view.setBusy(true, "asking…", "old question");

  view.setThread({ id: "t2", createdAt: "", entries: [entry("e2", "q2", "a2")] });
  const out = plain(view.render(60)).split("\n");
  assert.ok(!out.some((line) => line.includes("old question")));
  assert.ok(!out.some((line) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(line)));
  assert.ok(out.some((line) => line.includes("1/1"))); // no +1 for the hidden pending card

  view.setBusy(false); // busy was never truly cleared by setThread; clean up the spinner interval
});

test("setThread back to the thread that owns the pending request makes it reachable again", () => {
  const tui = { terminal: { rows: 40 }, requestRender: () => {} } as unknown as TUI;
  const view = new BtwThreadView(tui, theme, callbacks);
  const t1 = { id: "t1", createdAt: "", entries: [entry("e1", "q1", "a1")] };
  view.setThread(t1);
  view.setBusy(true, "asking…", "pending q");

  // Switch away: the pending card is hidden (covered by the test above).
  view.setThread({ id: "t2", createdAt: "", entries: [entry("e2", "q2", "a2")] });
  let out = plain(view.render(60)).split("\n");
  assert.ok(!out.some((line) => line.includes("pending q")));

  // Switch back before the in-flight request settles: the pending card is
  // reachable again (moveNext's totalCount() counts it once more).
  view.setThread(t1);
  view.handleInput(RIGHT); // onto the pending card (index == entries.length)
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("pending q")));
  assert.ok(out.some((line) => line.includes("2/2")));

  view.setBusy(false);
});

test("setThread with the same id/length keeps the cursor on the pending card", () => {
  const tui = { terminal: { rows: 40 }, requestRender: () => {} } as unknown as TUI;
  const view = new BtwThreadView(tui, theme, callbacks);
  const entries = [entry("e1", "q1", "a1")];
  view.setThread({ id: "t1", createdAt: "", entries });
  view.setBusy(true, "asking…", "pending q"); // cursor -> entries.length (index 1)
  let out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("2/2")));

  // Same id, same length (e.g. a Ctrl+L re-open of the same thread): the
  // cursor must stay on the pending card, not get clamped back to entries-1.
  view.setThread({ id: "t1", createdAt: "", entries: [{ ...entries[0] }] });
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("2/2")));
  assert.ok(out.some((line) => line.includes("pending q")));

  view.setBusy(false);
});

test("a small viewport (bodyBudget 4) still shows the YOU marker for the current card", () => {
  // rows 12 -> viewport 6 -> bodyBudget 4, matching the review's example.
  const view = createView([entry("e1", "question here", "answer here")], 12);
  const out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("YOU")));
});

test("the title stays visible while scrolling a long answer under a small viewport", () => {
  const longAnswer = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const view = createView([entry("e1", "q", longAnswer)], 12);

  view.handleInput(DOWN);
  view.handleInput(DOWN);
  view.handleInput(DOWN);
  const out = plain(view.render(50)).split("\n");
  assert.ok(out.some((line) => line.includes("btw ▸ thread")));
});

test("a wrapped title stays pinned in full while scrolling a long card under a narrow width", () => {
  // width 12 wraps "btw ▸ thread · 1/1" across three lines ("btw ▸",
  // "thread ·", "1/1"); rows=20 leaves enough budget to keep the whole
  // header pinned. All the wrapped fragments must survive scrolling.
  const longAnswer = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const view = createView([entry("e1", "q", longAnswer)], 20);

  view.handleInput(DOWN);
  view.handleInput(DOWN);
  view.handleInput(DOWN);
  const out = plain(view.render(12)).split("\n");
  assert.ok(out.some((line) => line.includes("btw")));
  assert.ok(out.some((line) => line.includes("1/1")));
});

test("select mode: enterSelect jumps to and marks the selected card; left moves selection; Enter promotes it", () => {
  let promotedId: string | null = null;
  const cb = { ...makeCallbacks(), onPromoteSelected: (id: string) => { promotedId = id; } };
  const entries = [entry("e1", "q1", "a1"), entry("e2", "q2", "a2"), entry("e3", "q3", "a3")];
  const view = createView(entries, 40, cb);

  view.enterSelect(["e1", "e2", "e3"]);
  let out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("▸ YOU")));
  assert.ok(out.some((line) => line.includes("3/3")));

  view.handleInput(LEFT);
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("▸ YOU")));
  assert.ok(out.some((line) => line.includes("2/3")));
  assert.ok(out.some((line) => line.includes("q2")));

  view.handleInput("\r"); // return/enter
  assert.equal(promotedId, "e2");
});

test("busy pending card: shows the pending question, a spinner frame, and total+1 in the title", () => {
  const view = createView([entry("e1", "q1", "a1")], 40);
  view.setBusy(true, "asking m…", "pending q");

  const out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("2/2")));
  assert.ok(out.some((line) => line.includes("pending q")));
  assert.ok(out.some((line) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(line)));

  view.setBusy(false); // clean up the spinner interval
});

test("setBusy does not reset scroll position: refining in the background keeps the read card in place", () => {
  const longAnswer = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  // rows=18: content budget >= 3 so the "↑ more" indicator has room to show.
  const view = createView([entry("e1", "q", longAnswer)], 18);

  view.handleInput(DOWN); // scroll down within the long card
  let out = plain(view.render(50)).split("\n");
  assert.ok(out.some((line) => line.includes("↑ more")));

  view.setBusy(true, "refining…"); // no pendingQuestion: a background refine, not a new ask
  out = plain(view.render(50)).split("\n");
  assert.ok(out.some((line) => line.includes("↑ more")));

  view.setBusy(false);
  out = plain(view.render(50)).split("\n");
  assert.ok(out.some((line) => line.includes("↑ more")));
});

test("refine spinner rides the pinned title even when scrolled deep into a long answer", () => {
  // The refine spinner used to render as a line at the bottom of the card
  // body, invisible once the card scrolled past the fold. It now rides in
  // the pinned title instead, so it must stay visible after scrolling.
  const longAnswer = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const view = createView([entry("e1", "q", longAnswer)], 18);

  view.handleInput(DOWN);
  view.handleInput(DOWN);
  view.handleInput(DOWN);

  view.setBusy(true, "refining…"); // no pendingQuestion: a background refine, not a new ask
  const out = plain(view.render(50)).split("\n");
  assert.ok(out.some((line) => line.includes("refining…")));

  view.setBusy(false);
});

test("input line and footer are always shown, even under a small viewport", () => {
  const entries = Array.from({ length: 5 }, (_, i) => entry(`e${i}`, `question ${i}`, "a somewhat long answer here"));
  const lines = render(entries, 90, 9);
  const output = plain(lines);

  assert.ok(output.includes("←→ questions | ↑↓ scroll"));
  const input = stripTerminalSequences(lines.at(-2) ?? "");
  assert.ok(input.startsWith("> "));
  assert.equal((input.match(/> /g) ?? []).length, 1);
  assert.ok(!input.includes("› >"));
  assert.ok(linesWithinWidth(lines, 90));
});

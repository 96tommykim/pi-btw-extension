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
  const view = createView([entry("e1", "first question", "first answer"), entry("e2", "second question", "second answer")]);
  const lines = plain(view.render(60)).split("\n");

  assert.equal(view.getTitle(), "btw · ‹ 2/2 ›");
  assert.ok(lines.some((line) => line.includes("second question")));
  assert.ok(lines.some((line) => line.includes("second answer")));
  assert.ok(!lines.some((line) => line.includes("first question")));
  assert.ok(!lines.some((line) => line.includes("first answer")));
});

test("left/right move between cards when the input is empty, clamped at the edges", () => {
  const view = createView([entry("e1", "first question", "first answer"), entry("e2", "second question", "second answer")]);

  assert.equal(view.getTitle(), "btw · ‹ 2/2 ›");

  view.handleInput(LEFT);
  assert.equal(view.getTitle(), "btw · ‹ 1/2 ›");
  let out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("first question")));

  view.handleInput(LEFT); // clamp at the first card
  assert.equal(view.getTitle(), "btw · ‹ 1/2 ›");

  view.handleInput(RIGHT);
  assert.equal(view.getTitle(), "btw · ‹ 2/2 ›");
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("second question")));
});

test("left does not change cards while the editor has text", () => {
  const view = createView([entry("e1", "first question", "first answer"), entry("e2", "second question", "second answer")]);
  view.handleInput("h"); // type into the editor; left/right now belong to it

  view.handleInput(LEFT);
  assert.equal(view.getTitle(), "btw · ‹ 2/2 ›");
  const out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("second question")));
});

test("PgUp/PgDn move cards regardless of editor contents", () => {
  const view = createView([entry("e1", "first question", "first answer"), entry("e2", "second question", "second answer")]);
  view.handleInput("h"); // non-empty editor should not block paging

  view.handleInput("\x1b[5~"); // pageUp
  assert.equal(view.getTitle(), "btw · ‹ 1/2 ›");

  view.handleInput("\x1b[6~"); // pageDown
  assert.equal(view.getTitle(), "btw · ‹ 2/2 ›");
});

test("a long answer under a small viewport shows scroll indicators and stays within width", () => {
  const longAnswer = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  // rows=18 -> contentBudget = 18 - 2 (overlay) - 3 (empty editor) - 2 (spacer + footer) = 11,
  // well short of the 23 content rows (question + blank + "btw" + 20 answer lines),
  // so the scroll indicators have room to appear.
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
  // rows=13 -> contentBudget = 13 - 2 (overlay) - 3 (empty editor) - 2 (spacer + footer) = 6.
  // question + blank + "btw" label + 3 answer lines = exactly 6 content rows --
  // no truncation, so no "↓ more" and the last answer line ("line 2") must be visible.
  const answer = Array.from({ length: 3 }, (_, i) => `line ${i}`).join("\n");
  const out = plain(render([entry("e1", "q", answer)], 50, 13)).split("\n");
  assert.ok(!out.some((line) => line.includes("↓ more")));
  assert.ok(out.some((line) => line.includes("line 2")));
});

test("tiny viewports (rows 9/10/11): the selected-card marker stays visible in select mode", () => {
  for (const rows of [9, 10, 11]) {
    const entries = [entry("e1", "q1", "a1"), entry("e2", "q2", "a2")];
    const view = createView(entries, rows);
    view.enterSelect(["e1", "e2"]);
    const out = plain(view.render(60)).split("\n");
    assert.ok(out.some((line) => line.includes("▸") && line.includes("❯")), `rows=${rows}`);
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
  assert.equal(view.getTitle(), "btw · ‹ 2/2 ›");

  // A third question goes out: setBusy moves the cursor onto the pending card
  // (index == entries.length == 2).
  view.setBusy(true, "asking…", "q3");
  assert.equal(view.getTitle(), "btw · ‹ 3/3 ›"); // 2 entries + pending card

  // Same thread id, the answer lands (entries grew from 2 to 3) while the
  // cursor was on the pending card: cursor jumps to (lands on) the new last entry.
  const grownEntries = [...sameLenEntries, entry("e3", "q3", "a3")];
  view.setBusy(false);
  view.setThread({ id: "t1", createdAt: "", entries: grownEntries });
  assert.equal(view.getTitle(), "btw · ‹ 3/3 ›");
  const out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("q3")));
});

test("setThread on the same thread: cursor does not jump when the user was reading an earlier card as entries grow", () => {
  const tui = { terminal: { rows: 40 }, requestRender: () => {} } as unknown as TUI;
  const view = new BtwThreadView(tui, theme, callbacks);
  const entries = [entry("e1", "q1", "a1"), entry("e2", "q2", "a2")];
  view.setThread({ id: "t1", createdAt: "", entries });

  view.handleInput(LEFT); // move to card 1/2
  assert.equal(view.getTitle(), "btw · ‹ 1/2 ›");

  // Same thread id, entries grew to 3: since the user was reading card 1 (not
  // the last/pending card), the cursor must stay put instead of jumping.
  const grownEntries = [...entries, entry("e3", "q3", "a3")];
  view.setThread({ id: "t1", createdAt: "", entries: grownEntries });
  assert.equal(view.getTitle(), "btw · ‹ 1/3 ›");
  const out = plain(view.render(60)).split("\n");
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
  assert.equal(view.getTitle(), "btw · ‹ 1/1 ›"); // no +1 for the hidden pending card

  view.setBusy(false); // busy was never truly cleared by setThread; clean up the loader interval
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
  assert.equal(view.getTitle(), "btw · ‹ 2/2 ›");

  view.setBusy(false);
});

test("setThread with the same id/length keeps the cursor on the pending card", () => {
  const tui = { terminal: { rows: 40 }, requestRender: () => {} } as unknown as TUI;
  const view = new BtwThreadView(tui, theme, callbacks);
  const entries = [entry("e1", "q1", "a1")];
  view.setThread({ id: "t1", createdAt: "", entries });
  view.setBusy(true, "asking…", "pending q"); // cursor -> entries.length (index 1)
  assert.equal(view.getTitle(), "btw · ‹ 2/2 ›");

  // Same id, same length (e.g. a Ctrl+L re-open of the same thread): the
  // cursor must stay on the pending card, not get clamped back to entries-1.
  view.setThread({ id: "t1", createdAt: "", entries: [{ ...entries[0] }] });
  assert.equal(view.getTitle(), "btw · ‹ 2/2 ›");
  const out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("pending q")));

  view.setBusy(false);
});

test("a tiny viewport still shows the current card's question line", () => {
  // rows=7 -> contentBudget = max(1, 7 - 2 (overlay) - 3 (empty editor) - 2 (spacer + footer)) = 1:
  // only the first content row survives, and it must be the question line.
  const view = createView([entry("e1", "question here", "answer here")], 7);
  const out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("question here")));
});

test("getTitle() keeps reporting the position while scrolling a long answer under a small viewport", () => {
  const longAnswer = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const view = createView([entry("e1", "q", longAnswer)], 12);

  view.handleInput(DOWN);
  view.handleInput(DOWN);
  view.handleInput(DOWN);
  const out = plain(view.render(50)).split("\n");
  assert.equal(view.getTitle(), "btw · ‹ 1/1 ›");
  assert.ok(out.some((line) => line.includes("↑ more")));
});

test("getTitle() returns the full title regardless of render width, even while a long card is scrolled under a narrow viewport", () => {
  const longAnswer = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const view = createView([entry("e1", "q", longAnswer)], 20);

  view.handleInput(DOWN);
  view.handleInput(DOWN);
  view.handleInput(DOWN);
  const out = view.render(12);
  assert.equal(view.getTitle(), "btw · ‹ 1/1 ›");
  assert.ok(linesWithinWidth(out, 12));
});

test("select mode: enterSelect jumps to and marks the selected card; left moves selection; Enter promotes it", () => {
  let promotedId: string | null = null;
  const cb = { ...makeCallbacks(), onPromoteSelected: (id: string) => { promotedId = id; } };
  const entries = [entry("e1", "q1", "a1"), entry("e2", "q2", "a2"), entry("e3", "q3", "a3")];
  const view = createView(entries, 40, cb);

  view.enterSelect(["e1", "e2", "e3"]);
  let out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("▸") && line.includes("❯")));
  assert.equal(view.getTitle(), "btw · ‹ 3/3 ›");

  view.handleInput(LEFT);
  out = plain(view.render(60)).split("\n");
  assert.ok(out.some((line) => line.includes("▸") && line.includes("❯")));
  assert.equal(view.getTitle(), "btw · ‹ 2/3 ›");
  assert.ok(out.some((line) => line.includes("q2")));

  view.handleInput("\r"); // return/enter
  assert.equal(promotedId, "e2");
});

test("busy pending card: shows the pending question, a spinner frame, and total+1 in the title", () => {
  const view = createView([entry("e1", "q1", "a1")], 40);
  view.setBusy(true, "asking m…", "pending q");

  const out = plain(view.render(60)).split("\n");
  assert.equal(view.getTitle(), "btw · ‹ 2/2 ›");
  assert.ok(out.some((line) => line.includes("pending q")));
  assert.ok(out.some((line) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(line)));

  view.setBusy(false); // clean up the loader interval
});

test("setBusy does not reset scroll position: refining in the background keeps the read card in place", () => {
  const longAnswer = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  // rows=18: content budget stays well short of the 23 content rows so the
  // "↑ more" indicator has room to show throughout.
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

test("refine loader rides below the content even when scrolled deep into a long answer", () => {
  // The refine spinner used to render as a line at the bottom of the card
  // body, invisible once the card scrolled past the fold. It now rides in a
  // dedicated loader row pinned below the content, so it must stay visible
  // after scrolling.
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

test("the editor and footer are always shown, even under a small viewport", () => {
  const entries = Array.from({ length: 5 }, (_, i) => entry(`e${i}`, `question ${i}`, "a somewhat long answer here"));
  const lines = render(entries, 90, 9);
  const output = plain(lines);

  assert.ok(output.includes("←→ questions"));
  assert.ok(output.includes("↑↓ scroll"));
  // The editor renders its own top/bottom "─" border lines just above the footer.
  const editorTop = stripTerminalSequences(lines.at(-4) ?? "");
  const editorBottom = stripTerminalSequences(lines.at(-2) ?? "");
  assert.ok(editorTop.includes("─"));
  assert.ok(editorBottom.includes("─"));
  assert.ok(linesWithinWidth(lines, 90));
});

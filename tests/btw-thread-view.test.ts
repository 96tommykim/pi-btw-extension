import assert from "node:assert";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { BtwThreadView } from "../lib/thread-view.ts";
import type { BtwEntry, BtwThread } from "../lib/threads.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const callbacks = {
  onSubmit: () => {},
  onNew: () => {},
  onList: () => {},
  onClose: () => {},
  onPromote: () => {},
  onPromoteSelected: () => {},
  onPromoteAll: () => {},
  onRefineSelected: () => {},
};

function entry(id: string, question: string, answer: string): BtwEntry {
  return {
    id,
    mode: "quick",
    question,
    answer,
    grounding: { capturedAt: "", model: "", contextInfo: "" },
  };
}

function createView(entries: BtwEntry[], rows = 40): BtwThreadView {
  const tui = {
    terminal: { rows },
    requestRender: () => {},
  } as unknown as TUI;
  const view = new BtwThreadView(tui, theme, callbacks);
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

test("renders labeled exchanges with a separator between entries", () => {
  const first = entry("e1", "first question", "first answer");
  first.promoted = true;
  const lines = plain(render([
    first,
    entry("e2", "second question", "second answer"),
  ])).split("\n");

  const firstYou = lines.findIndex((line) => line.includes("YOU"));
  const firstQuestion = lines.findIndex((line) => line.includes("first question"));
  const firstBtw = lines.findIndex((line) => line.includes("BTW"));
  const firstAnswer = lines.findIndex((line) => line.includes("first answer"));
  const shared = lines.findIndex((line) => line.includes("shared to main"));
  const divider = lines.findIndex((line) => line.includes("─"));
  const secondYou = lines.findIndex((line, i) => i > divider && line.includes("YOU"));
  const secondQuestion = lines.findIndex((line, i) => i > secondYou && line.includes("second question"));
  const secondBtw = lines.findIndex((line, i) => i > secondQuestion && line.includes("BTW"));

  assert.ok(firstYou >= 0 && firstQuestion === firstYou + 1 && firstBtw === firstQuestion + 2);
  assert.match(lines[firstQuestion], /^ {3}first question/);
  assert.match(lines[firstAnswer], /^ {3}first answer/);
  assert.match(lines[shared], /^ {3}✓ shared to main/);
  assert.match(lines[firstBtw - 1], /^\s*$/);
  assert.ok(divider > shared && secondYou > divider && secondQuestion === secondYou + 1 && secondBtw === secondQuestion + 2);
  assert.match(lines[divider + 1], /^\s*$/);
  assert.equal(lines.filter((line) => line.includes("YOU")).length, 2);
  assert.equal(lines.filter((line) => line.includes("BTW")).length, 2);
});

test("wraps a narrow question without rendering beyond the available width", () => {
  const words = ["albatross", "badger", "cormorant", "dormouse", "echidna"];
  const width = 22;
  const lines = render([entry("e1", words.join(" "), "brief answer")], width);
  const outputLines = plain(lines).split("\n");

  assert.ok(outputLines.some((line) => line.includes("YOU")));
  assert.equal(words.filter((word) => outputLines.some((line) => line.includes(word))).length, words.length);
  assert.ok(outputLines.filter((line) => words.some((word) => line.includes(word))).length > 1);
  assert.ok(lines.every((line) => visibleWidth(line) <= width));
});

function assertSelectedQuestion(lines: string[], question: string): void {
  const marker = lines.findIndex((line) => line.includes("▸ YOU"));
  assert.ok(marker >= 0);
  assert.ok(lines[marker + 1].includes(question));
  assert.match(lines[marker + 1], /^ {3}/);
}

test("keeps the selection marker visible while moving through constrained scrollback", () => {
  const entries = Array.from({ length: 8 }, (_, i) => entry(`e${i}`, `question ${i}`, "answer"));
  const view = createView(entries, 14);
  view.enterSelect(entries.map((entry) => entry.id));

  let output = plain(view.render(50)).split("\n");
  assertSelectedQuestion(output, "question 7");
  assert.ok(output.some((line) => line.includes("↑ more")));

  view.handleInput("\x1b[A");
  output = plain(view.render(50)).split("\n");
  assertSelectedQuestion(output, "question 6");

  view.handleInput("\x1b[B");
  output = plain(view.render(50)).split("\n");
  assertSelectedQuestion(output, "question 7");
  assert.ok(linesWithinWidth(output, 50));
});

function linesWithinWidth(lines: string[], width: number): boolean {
  return lines.every((line) => visibleWidth(line) <= width);
}

test("prioritizes the selected marker in a one-row body window", () => {
  const entries = Array.from({ length: 5 }, (_, i) => entry(`e${i}`, `question ${i}`, "answer"));
  const view = createView(entries, 9); // bodyBudget is one row
  view.enterSelect(entries.map((entry) => entry.id));
  view.handleInput("\x1b[A");
  view.handleInput("\x1b[A");

  const rawLines = view.render(34);
  const lines = plain(rawLines).split("\n");
  assert.ok(lines.some((line) => line.includes("▸ YOU")));
  assert.ok(!lines.some((line) => line.includes("↑ more") || line.includes("↓ more")));
  assert.ok(linesWithinWidth(rawLines, 34));
});

test("keeps the selected question in a two-row selection window", () => {
  const entries = Array.from({ length: 5 }, (_, i) => entry(`e${i}`, `question ${i}`, "answer"));
  const view = createView(entries, 10); // bodyBudget is two rows
  view.enterSelect(entries.map((entry) => entry.id));
  view.handleInput("\x1b[A");
  view.handleInput("\x1b[A");

  const rawLines = view.render(34);
  const lines = plain(rawLines).split("\n");
  assertSelectedQuestion(lines, "question 2");
  assert.ok(!lines.some((line) => line.includes("question 0") || line.includes("question 4")));
  assert.ok(!lines.some((line) => line.includes("↑ more") || line.includes("↓ more")));
  assert.ok(linesWithinWidth(rawLines, 34));
});

test("does not replace a selected question with a scroll indicator in a three-row window", () => {
  const entries = Array.from({ length: 5 }, (_, i) => entry(`e${i}`, `question ${i}`, "answer"));
  const view = createView(entries, 11); // bodyBudget is three rows
  view.enterSelect(entries.map((entry) => entry.id));
  view.handleInput("\x1b[A");
  view.handleInput("\x1b[A");

  const rawLines = view.render(34);
  const lines = plain(rawLines).split("\n");
  assertSelectedQuestion(lines, "question 2");
  assert.ok(lines.some((line) => line.includes("↑ more")));
  assert.ok(!lines.some((line) => line.includes("↓ more")));
  assert.ok(!lines.some((line) => line.includes("question 0") || line.includes("question 4")));
  assert.ok(linesWithinWidth(rawLines, 34));
});

test("keeps the input and footer visible when long scrollback is windowed", () => {
  const entries = Array.from({ length: 16 }, (_, i) =>
    entry(`e${i}`, `question ${i}`, "a deliberately long answer that fills the scrollback"),
  );
  const lines = render(entries, 90, 9);
  const output = plain(lines);

  assert.ok(output.includes("↑↓/PgUp/PgDn scroll"));
  const input = stripTerminalSequences(lines.at(-2) ?? "");
  assert.ok(input.startsWith("> "));
  assert.equal((input.match(/> /g) ?? []).length, 1);
  assert.ok(!input.includes("› >"));
  assert.ok(linesWithinWidth(lines, 90));
});

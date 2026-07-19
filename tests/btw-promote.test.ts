import assert from "node:assert";
import { test } from "node:test";
import { buildMultiPromoteNote, buildPromoteNote, buildRefinedPromoteNote } from "../extensions/btw/promote.ts";

test("single note keeps the V1 self-describing format", () => {
  assert.equal(
    buildPromoteNote("why?", "because."),
    "[/btw note — the user asked this as a side question and chose to share the answer with you]\nQ: why?\nA: because.",
  );
});

test("multi note joins Q/A blocks under one self-describing header", () => {
  const note = buildMultiPromoteNote([
    { question: "q1", answer: "a1" },
    { question: "q2", answer: "a2" },
  ]);
  assert.equal(
    note,
    "[/btw note — the user asked these side questions and chose to share the answers with you]\nQ: q1\nA: a1\n\nQ: q2\nA: a2",
  );
});

test("refined note wraps the summary body with the [/btw note prefix", () => {
  assert.equal(
    buildRefinedPromoteNote("the gist"),
    "[/btw note — the user asked a side question and chose to share a refined summary with you]\nthe gist",
  );
});

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** The self-describing note appended to main on promote (BTW_SPEC §7). */
export function buildPromoteNote(question: string, answer: string): string {
  return `[/btw note — the user asked this as a side question and chose to share the answer with you]\nQ: ${question}\nA: ${answer}`;
}

/** Whole-thread variant: every promotable Q/A of the thread in one note (§7). */
export function buildMultiPromoteNote(pairs: { question: string; answer: string }[]): string {
  const blocks = pairs.map((p) => `Q: ${p.question}\nA: ${p.answer}`).join("\n\n");
  return `[/btw note — the user asked these side questions and chose to share the answers with you]\n${blocks}`;
}

/** Refined variant: a shadow-pass rewrite of the Q/A instead of the raw text (§7). */
export function buildRefinedPromoteNote(summary: string): string {
  return `[/btw note — the user asked a side question and chose to share a refined summary with you]\n${summary}`;
}

/**
 * Queue the note as one user-visible message to the MAIN session. Uses
 * deliverAs:"nextTurn" so the model reads it on its next turn and no turn is
 * started now (queues correctly even if main is mid-run). BTW_SPEC §5.5/§9.
 */
export function sendPromote(pi: ExtensionAPI, note: string): void {
  pi.sendMessage(
    { customType: "btw-promote", content: note, display: true },
    { triggerTurn: false, deliverAs: "nextTurn" },
  );
}

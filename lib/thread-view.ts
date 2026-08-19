import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Editor, type EditorTheme, Loader, Markdown, matchesKey, Spacer, Text, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import { hintLine } from "./hints.ts";
import type { BtwThread } from "./threads";

const FOOTER_HINTS: Array<[string, string]> = [
  ["←→", "questions"],
  ["↑↓", "scroll"],
  ["⏎", "ask"],
  ["^p", "share"],
  ["esc", "close"],
];
const SELECT_FOOTER_HINTS: Array<[string, string]> = [
  ["←→", "pick"],
  ["⏎", "share"],
  ["a", "share all"],
  ["r", "refine+share"],
  ["esc", "cancel"],
];

/** Pager view for one thread: one Q/A card per screen, ←/→ moves between questions. */
export class BtwThreadView implements Component {
  private thread: BtwThread | null = null;
  private cursor = 0; // index of the entry currently shown (may equal entries.length for the pending card)
  private scrollOffset = 0; // lines hidden above the top of the current card (0 = card's question is at the top)
  private busy = false;
  private pendingQuestion: string | undefined;
  // The thread the in-flight busy/pending request belongs to. A thread switch
  // does not cancel the request (the caller's controller is still alive until
  // its promise settles), so busy/pendingQuestion stay set; this field is what
  // lets render() and totalCount() show the pending card only while the
  // displayed thread is the one that actually owns it.
  private pendingThreadId: string | null = null;
  // Promote select mode: Ctrl+P arms a cursor over promotable entry ids; the
  // ids are the source of truth (entries may grow while selecting).
  private selectIds: string[] | null = null;
  private selIdx = 0;
  // setThread bookkeeping: distinguishes "new answer landed" from "same thread,
  // same length" (e.g. a promoted flag flipping) so the cursor only jumps when
  // an exchange was actually added.
  private lastThreadId: string | null = null;
  private lastEntryCount = 0;
  private readonly editor: Editor;
  private readonly loader: Loader;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly cb: {
      onSubmit: (q: string) => void;
      onClose: () => void;
      onPromote: () => void;
      onPromoteSelected: (entryId: string) => void;
      onPromoteAll: () => void;
      onRefineSelected: (entryId: string) => void;
    },
  ) {
    const th = this.theme;
    const editorTheme: EditorTheme = {
      // "border" over pi-core's "borderMuted": on dark themes borderMuted is
      // near-invisible, and inside the overlay the editor rules double as the
      // content/input separator, so they must stay readable.
      borderColor: (s: string) => th.fg("border", s),
      selectList: {
        selectedPrefix: (s: string) => th.fg("accent", s),
        selectedText: (s: string) => th.fg("accent", s),
        description: (s: string) => th.fg("dim", s),
        scrollInfo: (s: string) => th.fg("dim", s),
        noMatch: (s: string) => th.fg("dim", s),
      },
    };
    this.editor = new Editor(this.tui, editorTheme);
    this.editor.onSubmit = (v) => {
      const q = v.trim();
      if (!q) return;
      if (this.busy) {
        // submitValue() already cleared the editor before calling onSubmit;
        // restore the text so a busy-rejected submit isn't silently lost.
        this.editor.setText(v);
        return;
      }
      this.cb.onSubmit(q);
    };
    this.loader = new Loader(this.tui, (s) => th.fg("accent", s), (s) => th.fg("muted", s));
    // Loader's constructor starts its own animation interval; cancel it until
    // setBusy(true) actually arms it, otherwise it ticks (and outlives the
    // view) while nothing is busy.
    this.loader.stop();
  }

  setThread(thread: BtwThread | null): void {
    const sameThread = thread !== null && this.lastThreadId !== null && thread.id === this.lastThreadId;
    const newCount = thread ? thread.entries.length : 0;
    this.thread = thread;
    this.selectIds = null;
    if (!sameThread) {
      // Switching threads does NOT clear busy/pendingQuestion: the caller's
      // request controller is still alive until its (possibly aborted)
      // promise settles, so a real request is genuinely in flight. Clearing
      // busy here would let Enter on the new thread slip past the caller's
      // "one request at a time" guard while that controller lives, silently
      // dropping the new question. Instead render()/totalCount() key off
      // pendingThreadId to hide the old thread's pending card/spinner while
      // it's not the displayed thread, and show it again if the user comes
      // back before it settles.
      this.cursor = Math.max(0, newCount - 1);
      this.scrollOffset = 0;
    } else {
      const last = Math.max(0, newCount - 1);
      if (newCount > this.lastEntryCount && this.cursor >= last) {
        // The watcher was on the pending card (index == old entries.length ==
        // last); land them on the answer that replaced it.
        this.cursor = last;
        this.scrollOffset = 0;
      } else {
        // Clamp against totalCount() (entries + pending card), not entries
        // alone: otherwise a cursor sitting on the pending card (index ==
        // entries.length) gets yanked back to the last real entry whenever
        // the same thread is re-set with an unchanged entry count (e.g. a
        // re-open of the same thread while a question is in flight).
        this.cursor = Math.min(this.cursor, Math.max(0, this.totalCount() - 1));
      }
    }
    this.lastThreadId = thread ? thread.id : null;
    this.lastEntryCount = newCount;
    this.tui.requestRender();
  }

  setBusy(busy: boolean, label = "", pendingQuestion?: string): void {
    this.busy = busy;
    this.pendingQuestion = busy ? pendingQuestion : undefined;
    this.pendingThreadId = busy ? (this.thread?.id ?? null) : null;
    if (busy) {
      if (pendingQuestion !== undefined) {
        this.cursor = this.thread?.entries.length ?? 0;
        this.scrollOffset = 0;
      }
      this.loader.setMessage(label || "asking…");
      this.loader.start();
    } else {
      this.loader.stop();
    }
    this.tui.requestRender();
  }

  /** Arm promote-select mode over these entry ids; cursor starts on the last, and the shown card jumps to it. */
  enterSelect(ids: string[]): void {
    if (!ids.length) return;
    this.selectIds = ids;
    this.selIdx = ids.length - 1;
    this.jumpToEntry(ids[this.selIdx]);
  }

  private exitSelect(): void {
    this.selectIds = null;
    this.tui.requestRender();
  }

  private jumpToEntry(entryId: string): void {
    const idx = (this.thread?.entries ?? []).findIndex((e) => e.id === entryId);
    if (idx >= 0) this.cursor = idx;
    this.scrollOffset = 0;
    this.tui.requestRender();
  }

  private totalCount(): number {
    const entries = this.thread?.entries.length ?? 0;
    const busyHere = this.busy && (this.thread?.id ?? null) === this.pendingThreadId;
    return entries + (busyHere && this.pendingQuestion !== undefined ? 1 : 0);
  }

  /** Title for the surrounding frame; the frame absorbs what used to be an inner header. */
  getTitle(): string {
    const total = this.totalCount();
    return total > 0 ? `btw · ‹ ${this.cursor + 1}/${total} ›` : "btw";
  }

  private movePrev(): void {
    if (this.totalCount() === 0) return;
    this.cursor = Math.max(0, this.cursor - 1);
    this.scrollOffset = 0;
    this.tui.requestRender();
  }

  private moveNext(): void {
    const total = this.totalCount();
    if (total === 0) return;
    this.cursor = Math.min(total - 1, this.cursor + 1);
    this.scrollOffset = 0;
    this.tui.requestRender();
  }

  private scrollBy(delta: number): void {
    this.scrollOffset = Math.max(0, this.scrollOffset + delta);
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (this.selectIds) {
      const ids = this.selectIds;
      if (matchesKey(data, "escape")) return this.exitSelect();
      if (matchesKey(data, "left")) { this.selIdx = Math.max(0, this.selIdx - 1); return this.jumpToEntry(ids[this.selIdx]); }
      if (matchesKey(data, "right")) { this.selIdx = Math.min(ids.length - 1, this.selIdx + 1); return this.jumpToEntry(ids[this.selIdx]); }
      if (matchesKey(data, "up")) return this.scrollBy(-1);
      if (matchesKey(data, "down")) return this.scrollBy(1);
      if (matchesKey(data, "return")) { this.exitSelect(); return this.cb.onPromoteSelected(ids[this.selIdx]); }
      if (data === "a") { this.exitSelect(); return this.cb.onPromoteAll(); }
      if (data === "r") { this.exitSelect(); return this.cb.onRefineSelected(ids[this.selIdx]); }
      return; // swallow everything else; the input line is inert while selecting
    }
    if (matchesKey(data, "ctrl+p")) return this.cb.onPromote();
    if (matchesKey(data, "escape")) return this.cb.onClose();
    if (matchesKey(data, "pageUp")) return this.movePrev();
    if (matchesKey(data, "pageDown")) return this.moveNext();
    // Up/down/left/right move between cards or scroll only while the editor
    // is empty; the Editor itself consumes those keys for cursor movement
    // once there is text (including up/down for multi-line navigation).
    if (this.editor.getText() === "") {
      if (matchesKey(data, "up")) return this.scrollBy(-1);
      if (matchesKey(data, "down")) return this.scrollBy(1);
      if (matchesKey(data, "left")) return this.movePrev();
      if (matchesKey(data, "right")) return this.moveNext();
    }
    this.editor.handleInput(data);
  }

  render(width: number): string[] {
    const th = this.theme;
    const entries = this.thread?.entries ?? [];
    // Only show the pending card/loader while the displayed thread is the
    // one that actually owns the in-flight request (see pendingThreadId).
    const busyHere = this.busy && (this.thread?.id ?? null) === this.pendingThreadId;
    const pendingActive = busyHere && this.pendingQuestion !== undefined;
    const total = entries.length + (pendingActive ? 1 : 0);
    if (this.cursor > total - 1) this.cursor = Math.max(0, total - 1);
    const showingPending = pendingActive && this.cursor === entries.length;

    const BOX_PADDING_Y = 1;
    const identityBg = (t: string) => t;

    const contentBox = new Box(1, BOX_PADDING_Y, identityBg);
    if (total === 0) {
      contentBox.addChild(new Text(th.fg("dim", "ask anything about this session below"), 0, 0));
    } else if (showingPending) {
      contentBox.addChild(
        new Text(`${th.fg("accent", "❯")} ${th.bold(th.fg("userMessageText", this.pendingQuestion ?? ""))}`, 0, 0),
      );
      contentBox.addChild(new Spacer(1));
      contentBox.addChild(new Text(th.fg("customMessageLabel", th.bold("btw")), 0, 0));
      contentBox.addChild(this.loader);
    } else {
      const e = entries[this.cursor];
      const marker = this.selectIds && e.id === this.selectIds[this.selIdx] ? th.fg("accent", "▸ ") : "";
      contentBox.addChild(
        new Text(`${marker}${th.fg("accent", "❯")} ${th.bold(th.fg("userMessageText", e.question))}`, 0, 0),
      );
      contentBox.addChild(new Spacer(1));
      contentBox.addChild(new Text(th.fg("customMessageLabel", th.bold("btw")), 0, 0));
      if (e.error) contentBox.addChild(new Text(th.fg("error", `⚠️  ${e.error}`), 2, 0));
      else contentBox.addChild(new Markdown(e.answer || "(empty)", 2, 0, getMarkdownTheme()));
      if (e.promoted) contentBox.addChild(new Text(th.fg("success", "✓ shared to main"), 2, 0));
    }

    const raw = contentBox.render(width);
    // Box always wraps its children with BOX_PADDING_Y blank rows on top and
    // bottom; strip both so contentLines holds only real content rows.
    const contentLines = raw.slice(BOX_PADDING_Y, raw.length - BOX_PADDING_Y);

    const inputLines = this.editor.render(width);
    const refineLoader = busyHere && !pendingActive ? this.loader.render(width) : [];
    const contentBudget = Math.max(
      1,
      this.tui.terminal.rows - 2 /* overlay frame */ - inputLines.length - refineLoader.length - 2 /* spacer + footer */,
    );

    let shownContent = contentLines;
    if (contentLines.length > contentBudget) {
      const maxOffset = contentLines.length - contentBudget;
      if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;
      const start = this.scrollOffset;
      const end = start + contentBudget;
      shownContent = contentLines.slice(start, end);
      // Indicators each consume a content row; only spend one when there's
      // room to spare it without hiding the card's first line under a tiny budget.
      if (contentBudget >= 3) {
        if (start > 0) shownContent = [th.fg("dim", "  ↑ more"), ...shownContent.slice(1)];
        if (end < contentLines.length) shownContent = [...shownContent.slice(0, -1), th.fg("dim", "  ↓ more")];
      }
    } else {
      this.scrollOffset = 0;
    }

    const footerHints = this.selectIds ? SELECT_FOOTER_HINTS : FOOTER_HINTS;
    const footer = truncateToWidth(hintLine(th, footerHints), width, th.fg("dim", "…"));

    // One breathing row between the card and the input area.
    return [...shownContent, "", ...refineLoader, ...inputLines, footer];
  }

  invalidate(): void {
    this.editor.invalidate();
  }
}

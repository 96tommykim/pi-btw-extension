import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Input, Markdown, matchesKey, Spacer, Text, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import type { BtwThread } from "./threads";

const FOOTER = "  ←→ questions | ↑↓ scroll | Enter ask | Ctrl+P share | Ctrl+L threads | Ctrl+N new | Esc close";
const SELECT_FOOTER = "  ←→ pick | Enter share | a share all | r refine+share | Esc cancel";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Pager view for one thread: one Q/A card per screen, ←/→ moves between questions. */
export class BtwThreadView implements Component {
  private thread: BtwThread | null = null;
  private cursor = 0; // index of the entry currently shown (may equal entries.length for the pending card)
  private scrollOffset = 0; // lines hidden above the top of the current card (0 = card's question is at the top)
  private busy = false;
  private busyLabel = "";
  private pendingQuestion: string | undefined;
  // The thread the in-flight busy/pending request belongs to. A thread switch
  // does not cancel the request (the caller's controller is still alive until
  // its promise settles), so busy/pendingQuestion stay set; this field is what
  // lets render() and totalCount() show the pending card only while the
  // displayed thread is the one that actually owns it.
  private pendingThreadId: string | null = null;
  private spinnerFrame = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  // Promote select mode: Ctrl+P arms a cursor over promotable entry ids; the
  // ids are the source of truth (entries may grow while selecting).
  private selectIds: string[] | null = null;
  private selIdx = 0;
  // setThread bookkeeping: distinguishes "new answer landed" from "same thread,
  // same length" (e.g. a promoted flag flipping) so the cursor only jumps when
  // an exchange was actually added.
  private lastThreadId: string | null = null;
  private lastEntryCount = 0;
  private readonly input = new Input();

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly cb: {
      onSubmit: (q: string) => void;
      onNew: () => void;
      onList: () => void;
      onClose: () => void;
      onPromote: () => void;
      onPromoteSelected: (entryId: string) => void;
      onPromoteAll: () => void;
      onRefineSelected: (entryId: string) => void;
    },
  ) {
    this.input.onSubmit = (v) => {
      const q = v.trim();
      if (!q || this.busy) return;
      this.input.setValue("");
      this.cb.onSubmit(q);
    };
    this.input.onEscape = () => this.cb.onClose();
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
        // Ctrl+L re-open while a question is in flight).
        this.cursor = Math.min(this.cursor, Math.max(0, this.totalCount() - 1));
      }
    }
    this.lastThreadId = thread ? thread.id : null;
    this.lastEntryCount = newCount;
    this.tui.requestRender();
  }

  setBusy(busy: boolean, label = "", pendingQuestion?: string): void {
    this.busy = busy;
    this.busyLabel = label;
    this.pendingQuestion = busy ? pendingQuestion : undefined;
    this.pendingThreadId = busy ? (this.thread?.id ?? null) : null;
    if (busy) {
      if (pendingQuestion !== undefined) {
        this.cursor = this.thread?.entries.length ?? 0;
        this.scrollOffset = 0;
      }
      this.startSpinner();
    } else {
      this.stopSpinner();
    }
    this.tui.requestRender();
  }

  private startSpinner(): void {
    if (this.spinnerInterval) return;
    this.spinnerFrame = 0;
    this.spinnerInterval = setInterval(() => {
      // Only the pending request's owning thread ever shows a spinner frame
      // (see busyHere in render()); while some other thread is displayed the
      // frame is invisible, so skip the render entirely.
      if ((this.thread?.id ?? null) !== this.pendingThreadId) return;
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.tui.requestRender();
    }, 100);
    this.spinnerInterval.unref();
  }

  private stopSpinner(): void {
    if (!this.spinnerInterval) return;
    clearInterval(this.spinnerInterval);
    this.spinnerInterval = null;
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
    if (matchesKey(data, "ctrl+l")) return this.cb.onList();
    if (matchesKey(data, "ctrl+n")) return this.cb.onNew();
    if (matchesKey(data, "ctrl+p")) return this.cb.onPromote();
    if (matchesKey(data, "escape")) return this.cb.onClose();
    if (matchesKey(data, "pageUp")) return this.movePrev();
    if (matchesKey(data, "pageDown")) return this.moveNext();
    if (matchesKey(data, "up")) return this.scrollBy(-1);
    if (matchesKey(data, "down")) return this.scrollBy(1);
    // Left/right move between cards only when the input is empty; otherwise
    // they belong to the input's own cursor movement.
    if (matchesKey(data, "left") && !this.input.getValue()) return this.movePrev();
    if (matchesKey(data, "right") && !this.input.getValue()) return this.moveNext();
    // Everything else (printable chars, Enter, backspace, left/right while typing) goes to the input.
    this.input.handleInput(data);
  }

  render(width: number): string[] {
    const th = this.theme;
    const entries = this.thread?.entries ?? [];
    // Only show the pending card/spinner while the displayed thread is the
    // one that actually owns the in-flight request (see pendingThreadId).
    const busyHere = this.busy && (this.thread?.id ?? null) === this.pendingThreadId;
    const pendingActive = busyHere && this.pendingQuestion !== undefined;
    const total = entries.length + (pendingActive ? 1 : 0);
    if (this.cursor > total - 1) this.cursor = Math.max(0, total - 1);
    const showingPending = pendingActive && this.cursor === entries.length;

    const BOX_PADDING_Y = 1;
    const bg = (t: string) => th.bg("customMessageBg", t);

    // Header: title only, in its own Box. Its rendered output is kept in
    // full (not sliced by an assumed line count) because a narrow width can
    // wrap the title itself across several lines; every one of them must
    // stay pinned above the scrolling content. The refine spinner (busyHere
    // && !pendingActive) rides in the title string below instead of a
    // separate card-bottom line, so it stays pinned too.
    let title = total > 0 ? `btw ▸ thread · ${this.cursor + 1}/${total}` : "btw ▸ new thread";
    if (busyHere && !pendingActive) title += ` · ${SPINNER_FRAMES[this.spinnerFrame]} ${this.busyLabel || "busy…"}`;
    const headerBox = new Box(1, BOX_PADDING_Y, bg);
    headerBox.addChild(new Text(th.fg("accent", title), 0, 0));
    // headerBox's own bottom padding row (from Box's paddingY) doubles as the
    // blank line separating the header from the card content below.
    const headerLines = headerBox.render(width);

    // Content: card body only (YOU/question/BTW/answer/promoted, the pending
    // card, or the empty-thread prompt) in a separate Box.
    const contentBox = new Box(1, BOX_PADDING_Y, bg);
    if (total === 0) {
      contentBox.addChild(new Text(th.fg("dim", "ask anything about this session below"), 0, 0));
    } else if (showingPending) {
      contentBox.addChild(new Text(th.fg("userMessageText", th.bold("YOU")), 0, 0));
      contentBox.addChild(new Text(th.fg("userMessageText", this.pendingQuestion ?? ""), 2, 0));
      contentBox.addChild(new Spacer(1));
      contentBox.addChild(new Text(th.fg("customMessageLabel", th.bold("BTW")), 0, 0));
      contentBox.addChild(new Text(th.fg("accent", `${SPINNER_FRAMES[this.spinnerFrame]} ${this.busyLabel || "asking…"}`), 2, 0));
    } else {
      const e = entries[this.cursor];
      const marker = this.selectIds && e.id === this.selectIds[this.selIdx] ? th.fg("accent", "▸ ") : "";
      const youLabel = th.fg("userMessageText", th.bold("YOU"));
      contentBox.addChild(new Text(`${marker}${youLabel}`, 0, 0));
      contentBox.addChild(new Text(th.fg("userMessageText", e.question), 2, 0));
      contentBox.addChild(new Spacer(1));
      contentBox.addChild(new Text(th.fg("customMessageLabel", th.bold("BTW")), 0, 0));
      if (e.error) contentBox.addChild(new Text(th.fg("error", `⚠️  ${e.error}`), 2, 0));
      else contentBox.addChild(new Markdown(e.answer || "(empty)", 2, 0, getMarkdownTheme()));
      if (e.promoted) contentBox.addChild(new Text(th.fg("dim", "✓ shared to main"), 2, 0));
    }

    const raw = contentBox.render(width);
    // Box always wraps its children with BOX_PADDING_Y blank rows on top and
    // bottom (regardless of what the children themselves rendered); strip
    // both so contentLines holds only real content rows. Left in, that pad
    // row was the hidden line the old off-by-one math clipped from the
    // header instead — surfacing as "↓ more" covering the last real line, or
    // the header slice swallowing the card's first (YOU) line.
    const contentLines = raw.slice(BOX_PADDING_Y, raw.length - BOX_PADDING_Y);

    // Reserve rows for the input (1) + footer (1); window the card to fit.
    // -6 not -4: the overlay frame (top+bottom border) now takes two rows.
    const viewport = Math.max(3, this.tui.terminal.rows - 6);
    const bodyBudget = Math.max(1, viewport - 2);
    // Keep the header (title/position) pinned outside the scrolling window so
    // it survives scrolling a long card. On a terminal too small to fit both,
    // drop the header entirely and give the card content the whole budget —
    // seeing the question/answer matters more than the position readout.
    let contentBudget = bodyBudget - headerLines.length;
    let showHeader = true;
    if (contentBudget < 1) {
      showHeader = false;
      contentBudget = bodyBudget;
    }

    let shownContent = contentLines;
    if (contentLines.length > contentBudget) {
      const maxOffset = contentLines.length - contentBudget;
      if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;
      const start = this.scrollOffset;
      const end = start + contentBudget;
      shownContent = contentLines.slice(start, end);
      // Indicators each consume a content row; only spend one when there's
      // room to spare it without hiding the card's first line (the YOU/▸
      // marker) under a tiny budget.
      if (contentBudget >= 3) {
        if (start > 0) shownContent = [th.fg("dim", "  ↑ more"), ...shownContent.slice(1)];
        if (end < contentLines.length) shownContent = [...shownContent.slice(0, -1), th.fg("dim", "  ↓ more")];
      }
    } else {
      this.scrollOffset = 0;
    }
    const shown = showHeader ? [...headerLines, ...shownContent] : shownContent;

    // --- input + footer ---
    const inputLines = this.input.render(width).map((l) => truncateToWidth(l, width));
    return [...shown, ...inputLines, truncateToWidth(th.fg("dim", this.selectIds ? SELECT_FOOTER : FOOTER), width)];
  }

  invalidate(): void {
    this.input.invalidate();
  }
}

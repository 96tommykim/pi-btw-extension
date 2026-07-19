import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Input, Markdown, matchesKey, Text, type TUI } from "@earendil-works/pi-tui";
import type { BtwThread } from "./threads";

const FOOTER = "  ↑↓/PgUp/PgDn scroll | Enter ask | Ctrl+P share | Ctrl+L threads | Ctrl+N new | Esc close";
const SELECT_FOOTER = "  ↑↓ pick | Enter share | a share all | r refine+share | Esc cancel";

/** Chat view for one thread: scrollback of Q/A (markdown) + a bottom input. */
export class BtwThreadView implements Component {
  private thread: BtwThread | null = null;
  private busy = false;
  private busyLabel = "";
  private scrollOffset = 0; // lines hidden below the bottom (0 = pinned to latest)
  // Promote select mode: Ctrl+P arms a cursor over promotable entry ids; the
  // ids are the source of truth (entries may grow while selecting).
  private selectIds: string[] | null = null;
  private selIdx = 0;
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
    this.thread = thread;
    this.scrollOffset = 0;
    this.selectIds = null;
    this.tui.requestRender();
  }

  setBusy(busy: boolean, label = ""): void {
    this.busy = busy;
    this.busyLabel = label;
    this.scrollOffset = 0; // keep the latest exchange in view
    this.tui.requestRender();
  }

  /** Arm promote-select mode over these entry ids; cursor starts on the last. */
  enterSelect(ids: string[]): void {
    if (!ids.length) return;
    this.selectIds = ids;
    this.selIdx = ids.length - 1;
    this.tui.requestRender();
  }

  private exitSelect(): void {
    this.selectIds = null;
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (this.selectIds) {
      const ids = this.selectIds;
      if (matchesKey(data, "escape")) return this.exitSelect();
      if (matchesKey(data, "up")) { this.selIdx = Math.max(0, this.selIdx - 1); return this.tui.requestRender(); }
      if (matchesKey(data, "down")) { this.selIdx = Math.min(ids.length - 1, this.selIdx + 1); return this.tui.requestRender(); }
      if (matchesKey(data, "return")) { this.exitSelect(); return this.cb.onPromoteSelected(ids[this.selIdx]); }
      if (data === "a") { this.exitSelect(); return this.cb.onPromoteAll(); }
      if (data === "r") { this.exitSelect(); return this.cb.onRefineSelected(ids[this.selIdx]); }
      return; // swallow everything else; the input line is inert while selecting
    }
    if (matchesKey(data, "ctrl+l")) return this.cb.onList();
    if (matchesKey(data, "ctrl+n")) return this.cb.onNew();
    if (matchesKey(data, "ctrl+p")) return this.cb.onPromote();
    if (matchesKey(data, "escape")) return this.cb.onClose();
    if (matchesKey(data, "up")) return this.scrollBy(1);
    if (matchesKey(data, "down")) return this.scrollBy(-1);
    if (matchesKey(data, "pageUp")) return this.scrollBy(10);
    if (matchesKey(data, "pageDown")) return this.scrollBy(-10);
    // Everything else (printable chars, Enter, backspace, left/right) goes to the input.
    this.input.handleInput(data);
  }

  private scrollBy(delta: number): void {
    this.scrollOffset = Math.max(0, this.scrollOffset + delta);
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const th = this.theme;
    // --- body: build the full scrollback, then window it to the viewport ---
    const body = new Box(1, 1, (t) => th.bg("customMessageBg", t));
    const title = this.thread ? "btw ▸ thread" : "btw ▸ new thread";
    body.addChild(new Text(th.fg("accent", title), 0, 0));
    body.addChild(new Text("", 0, 0));
    const selectedId = this.selectIds ? this.selectIds[this.selIdx] : null;
    const spans = new Map<string, [number, number]>(); // entry id → [startLine, endLine)
    // -1: Box renders its bottom pad row on every call; content coordinates in the
    // final bodyLines exclude it (it gets pushed past all later children).
    let prevLines = this.selectIds ? body.render(width).length - 1 : 0;
    if (this.thread && this.thread.entries.length > 0) {
      for (const e of this.thread.entries) {
        const qLine = e.id === selectedId ? th.fg("accent", `▸ Q: ${e.question}`) : th.fg("dim", `Q: ${e.question}`);
        body.addChild(new Text(qLine, 0, 0));
        if (e.error) body.addChild(new Text(th.fg("error", `⚠️  ${e.error}`), 0, 0));
        else body.addChild(new Markdown(e.answer || "(empty)", 0, 0, getMarkdownTheme()));
        if (e.promoted) body.addChild(new Text(th.fg("dim", "✓ shared to main"), 0, 0));
        body.addChild(new Text("", 0, 0));
        if (this.selectIds) {
          const n = body.render(width).length - 1;
          spans.set(e.id, [prevLines, n]);
          prevLines = n;
        }
      }
    } else {
      body.addChild(new Text(th.fg("dim", "ask anything about this session below"), 0, 0));
      body.addChild(new Text("", 0, 0));
    }
    if (this.busy) body.addChild(new Text(th.fg("accent", `⋯ ${this.busyLabel || "asking…"}`), 0, 0));

    const bodyLines = body.render(width);

    // Reserve rows for the input (1) + footer (1); window the scrollback to fit.
    // -6 not -4: the overlay frame (top+bottom border) now takes two rows.
    const viewport = Math.max(3, this.tui.terminal.rows - 6);
    const bodyBudget = Math.max(1, viewport - 2);
    // Keep the selected entry inside the visible window while picking.
    if (selectedId && bodyLines.length > bodyBudget) {
      const span = spans.get(selectedId);
      if (span) {
        const maxOffset = bodyLines.length - bodyBudget;
        const winEnd = bodyLines.length - this.scrollOffset;
        if (span[1] + 1 > winEnd) this.scrollOffset = Math.max(0, bodyLines.length - span[1] - 1);
        else if (span[0] - 1 < winEnd - bodyBudget)
          this.scrollOffset = Math.min(maxOffset, bodyLines.length - Math.max(0, span[0] - 1) - bodyBudget);
      }
    }
    let shown = bodyLines;
    if (bodyLines.length > bodyBudget) {
      const maxOffset = bodyLines.length - bodyBudget;
      if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;
      const end = bodyLines.length - this.scrollOffset;
      shown = bodyLines.slice(Math.max(0, end - bodyBudget), end);
      if (this.scrollOffset < maxOffset) shown = [th.fg("dim", "  ↑ more"), ...shown.slice(1)];
      if (this.scrollOffset > 0) shown = [...shown.slice(0, -1), th.fg("dim", "  ↓ more")];
    } else {
      this.scrollOffset = 0;
    }

    // --- input + footer ---
    const prompt = th.fg("accent", "› ");
    const inputLines = this.input.render(width - 2).map((l, i) => (i === 0 ? prompt + l : l));
    return [...shown, ...inputLines, th.fg("dim", this.selectIds ? SELECT_FOOTER : FOOTER)];
  }

  invalidate(): void {
    this.input.invalidate();
  }
}

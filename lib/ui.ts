import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { getConfig } from "./config";
import type { Grounding } from "./context";
import { BtwListView } from "./list-view";
import { buildMultiPromoteNote, buildPromoteNote, buildRefinedPromoteNote } from "./promote";
import { runRefine, runSide } from "./shadow";
import type { BtwEntry, ThreadStore } from "./threads";
import { BtwThreadView } from "./thread-view";

type View = "thread" | "list";

class BtwOverlay implements Component {
  private view: View = "thread";
  private readonly threadView: BtwThreadView;
  private listView: BtwListView | null = null;
  private controller: AbortController | null = null;
  private settled = false;
  // Defensive: a thrown render/handleInput must never blank+freeze the whole pi TUI.
  // Capture it, show it, and let Esc dismiss. Also surfaces the cause for debugging.
  private lastError: string | null = null;

  constructor(
    private readonly ctx: ExtensionContext,
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly threads: ThreadStore,
    private readonly grounding: Grounding,
    private readonly done: () => void,
    private readonly onPromote?: (note: string) => void,
  ) {
    this.threadView = new BtwThreadView(tui, theme, {
      onSubmit: (q) => this.ask(q),
      onNew: () => this.newThread(),
      onList: () => this.showList(),
      onClose: () => this.close(),
      onPromote: () => this.openPromote(),
      onPromoteSelected: (id) => this.promoteEntry(id),
      onPromoteAll: () => this.promoteAll(),
      onRefineSelected: (id) => this.refineEntry(id),
    });
    this.threadView.setThread(this.threads.getActive());
  }

  submitInitial(q: string): void {
    this.ensureActive();
    this.threadView.setThread(this.threads.getActive());
    this.ask(q);
  }

  private ensureActive(): void {
    if (!this.threads.getActive()) this.threads.newThread();
  }

  private newThread(): void {
    // A thread switch must not let an in-flight answer land in the old thread
    // while the view shows the new one.
    this.controller?.abort();
    this.threads.newThread();
    this.threadView.setThread(this.threads.getActive());
    this.view = "thread";
    this.tui.requestRender();
  }

  private showList(): void {
    this.listView = new BtwListView(this.threads.listThreads(), this.theme, {
      onOpen: (id) => {
        this.controller?.abort();
        this.threads.setActive(id);
        this.threadView.setThread(this.threads.getActive());
        this.view = "thread";
        this.tui.requestRender();
      },
      onNew: () => this.newThread(),
      onClose: () => {
        // Deleting the active thread clears it; there is nothing to return to,
        // so Esc closes the overlay instead of reopening a dead thread view.
        if (this.threads.getActive()) {
          this.view = "thread";
          this.tui.requestRender();
        } else {
          this.close();
        }
      },
      onDelete: (id) => {
        // A running ask can only belong to the active thread; if that is the
        // one being deleted, abort it so its result cannot land in a ghost.
        const active = this.threads.getActive();
        if (this.controller && active && active.id === id) this.controller.abort();
        this.threads.deleteThread(id);
        this.showList();
      },
    });
    this.view = "list";
    this.tui.requestRender();
  }

  private ask(question: string): void {
    if (this.controller) return; // one in-flight ask at a time
    this.ensureActive();
    const active = this.threads.getActive();
    if (!active) return;
    const settings = getConfig();
    const prefix = this.grounding.getGroundingPrefix(this.ctx);
    const tail = this.threads.tailDigest(active.id);
    const model = this.ctx.model;
    this.controller = new AbortController();
    this.threadView.setBusy(true, `asking ${model?.id ?? "model"}…`);
    runSide(this.ctx, { prefix, tail, question, settings, signal: this.controller.signal })
      .then((r) => {
        if (this.settled) return;
        const entry: BtwEntry = {
          id: this.threads.nextId(),
          mode: r.toolsUsed.length ? "deep" : "quick",
          question,
          answer: r.aborted ? "" : r.text.trim(),
          grounding: { capturedAt: stamp(), model: model?.id ?? "unknown", contextInfo: `${prefix.length} prefix msgs` },
          ...(r.toolsUsed.length ? { toolsUsed: r.toolsUsed } : {}),
          ...(r.error ? { error: r.error } : {}),
        };
        if (!r.aborted) this.threads.append(active.id, entry);
        this.threadView.setThread(this.threads.getActive());
      })
      .catch((e) => {
        if (this.settled) return;
        this.threads.append(active.id, {
          id: this.threads.nextId(), mode: "quick", question, answer: "",
          grounding: { capturedAt: stamp(), model: model?.id ?? "unknown", contextInfo: "" },
          error: e instanceof Error ? e.message : String(e),
        });
        this.threadView.setThread(this.threads.getActive());
      })
      .finally(() => {
        this.controller = null;
        if (!this.settled) this.threadView.setBusy(false);
      });
  }

  private close(): void {
    if (this.settled) return;
    this.settled = true;
    this.controller?.abort();
    this.done();
  }

  private promotable(): BtwEntry[] {
    const active = this.threads.getActive();
    return active ? active.entries.filter((e) => !e.error && e.answer.trim() && !e.promoted) : [];
  }

  private openPromote(): void {
    if (!this.onPromote) return;
    const ids = this.promotable().map((e) => e.id);
    if (!ids.length) {
      this.ctx.ui.notify("btw: nothing to promote (no unshared answer)", "info");
      return;
    }
    this.threadView.enterSelect(ids);
  }

  private promoteEntry(entryId: string): void {
    const active = this.threads.getActive();
    if (!active || !this.onPromote) return;
    const entry = active.entries.find((e) => e.id === entryId);
    if (!entry) return;
    this.onPromote(buildPromoteNote(entry.question, entry.answer));
    this.threads.markPromoted(active.id, entry.id);
    this.threadView.setThread(this.threads.getActive());
    this.ctx.ui.notify("btw: shared to main. The note reaches the agent on its next turn", "info");
    this.tui.requestRender();
  }

  private promoteAll(): void {
    const active = this.threads.getActive();
    if (!active || !this.onPromote) return;
    const entries = this.promotable();
    if (!entries.length) return;
    this.onPromote(buildMultiPromoteNote(entries));
    for (const e of entries) this.threads.markPromoted(active.id, e.id);
    this.threadView.setThread(this.threads.getActive());
    this.ctx.ui.notify(`btw: shared ${entries.length} answers to main`, "info");
    this.tui.requestRender();
  }

  private refineEntry(entryId: string): void {
    if (this.controller) {
      this.ctx.ui.notify("btw: busy. Refine again once the current run settles", "info");
      return;
    }
    const active = this.threads.getActive();
    if (!active || !this.onPromote) return;
    const entry = active.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const settings = getConfig();
    const prefix = this.grounding.getGroundingPrefix(this.ctx);
    this.controller = new AbortController();
    this.threadView.setBusy(true, "refining…");
    runRefine(this.ctx, { prefix, question: entry.question, answer: entry.answer, settings, signal: this.controller.signal })
      .then((r) => {
        if (this.settled || r.aborted) return;
        if (r.error || !r.text) {
          this.ctx.ui.notify(`btw: refine failed${r.error ? `: ${r.error}` : ""}`, "error");
          return;
        }
        if (entry.promoted) return; // promoted raw while this refine was in flight, don't double-share
        this.onPromote?.(buildRefinedPromoteNote(r.text));
        this.threads.markPromoted(active.id, entry.id);
        this.threadView.setThread(this.threads.getActive());
        this.ctx.ui.notify("btw: refined note shared to main", "info");
      })
      .catch((e) => {
        if (this.settled) return;
        this.ctx.ui.notify(`btw: refine failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      })
      .finally(() => {
        this.controller = null;
        if (!this.settled) this.threadView.setBusy(false);
      });
  }

  handleInput(data: string): void {
    if (this.lastError) {
      if (matchesKey(data, "escape") || matchesKey(data, "return")) this.close();
      return;
    }
    try {
      if (this.view === "list" && this.listView) this.listView.handleInput(data);
      else this.threadView.handleInput(data);
    } catch (e) {
      this.lastError = e instanceof Error ? (e.stack ?? e.message) : String(e);
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    try {
      if (this.lastError) return withFrame(this.errorPanel(this.lastError, "handleInput"), width, this.theme);
      const inner =
        this.view === "list" && this.listView
          ? this.listView.render(Math.max(10, width - 2))
          : this.threadView.render(Math.max(10, width - 2));
      return withFrame(inner, width, this.theme);
    } catch (e) {
      const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
      return withFrame(this.errorPanel(detail, "render"), width, this.theme);
    }
  }

  private errorPanel(detail: string, where: string): string[] {
    const head = this.theme.fg("error", `btw ${where} error (Esc to close):`);
    const body = detail.split("\n").slice(0, 14).map((l) => this.theme.fg("dim", l.slice(0, 200)));
    return [head, ...body];
  }

  invalidate(): void {
    this.threadView.invalidate();
    this.listView?.invalidate();
  }
}

function stamp(): string {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

/**
 * Rounded accent frame around the overlay so it reads as a floating panel,
 * visually distinct from the main session (which has no border).
 */
function withFrame(lines: string[], width: number, th: Theme): string[] {
  const innerW = Math.max(10, width - 2);
  const title = " btw ";
  const top =
    th.fg("borderAccent", "╭─") +
    th.fg("accent", title) +
    th.fg("borderAccent", "─".repeat(Math.max(0, innerW - title.length - 1)) + "╮");
  const bottom = th.fg("borderAccent", "╰" + "─".repeat(innerW) + "╯");
  const side = th.fg("borderAccent", "│");
  const fit = (l: string): string => {
    // Re-measure after truncation: a wide grapheme dropped at the boundary
    // can leave the cut line short, and the right border must stay aligned.
    const cut = visibleWidth(l) > innerW ? truncateToWidth(l, innerW) : l;
    return cut + " ".repeat(Math.max(0, innerW - visibleWidth(cut)));
  };
  return [top, ...lines.map((l) => side + fit(l) + side), bottom];
}

/** Open the persistent /btw overlay on the active thread. */
export async function openOverlay(
  ctx: ExtensionContext,
  threads: ThreadStore,
  grounding: Grounding,
  initialQuestion?: string,
  onPromote?: (note: string) => void,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/btw requires interactive mode", "error");
    return;
  }
  if (!ctx.model) {
    ctx.ui.notify("No model selected", "error");
    return;
  }
  const q = initialQuestion?.trim();
  // On a plain reopen (no question), if nothing is active but threads remain
  // (for example the active thread was just deleted), land on the most recent
  // one rather than a blank view. threads are stored oldest-first. A `/btw
  // <question>` reopen is left alone: it intentionally starts a fresh thread.
  if (!q && !threads.getActive()) {
    const all = threads.listThreads();
    if (all.length) threads.setActive(all[all.length - 1].id);
  }
  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => {
      const overlay = new BtwOverlay(ctx, tui, theme, threads, grounding, done, onPromote);
      if (q) overlay.submitInitial(q);
      return overlay;
    },
    { overlay: true, overlayOptions: { width: "80%", anchor: "center" } },
  );
}

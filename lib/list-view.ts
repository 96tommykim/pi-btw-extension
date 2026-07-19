import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component, matchesKey, SelectList, Text } from "@earendil-works/pi-tui";
import type { BtwThread } from "./threads";

/** Thread-picker view: newest first; Enter opens, Ctrl+N new, Esc closes. */
export class BtwListView implements Component {
  private readonly list: SelectList | null;
  private readonly empty: boolean;
  // When set, a delete confirmation is armed on this row: the next `x` deletes it,
  // any other key cancels. Held here (not in the store) so it is purely view state.
  private armed: { id: string; label: string } | null = null;

  constructor(
    threads: BtwThread[],
    private readonly theme: Theme,
    private readonly cb: {
      onOpen: (id: string) => void;
      onNew: () => void;
      onClose: () => void;
      onDelete: (id: string) => void;
    },
  ) {
    this.empty = threads.length === 0;
    if (this.empty) {
      this.list = null;
    } else {
      const items = [...threads].reverse().map((t) => ({
        value: t.id,
        label: t.entries[0]?.question?.trim() || "(empty thread)",
        description: `${t.entries.length} Q/A`,
      }));
      this.list = new SelectList(items, 8, getSelectListTheme());
      this.list.onSelect = (item) => this.cb.onOpen(item.value);
      this.list.onCancel = () => this.cb.onClose();
    }
  }

  handleInput(data: string): void {
    // An armed confirmation intercepts everything: a second `x` commits the
    // delete, any other key cancels it and is consumed (it does not also act).
    if (this.armed) {
      const armed = this.armed;
      this.armed = null;
      if (data === "x") this.cb.onDelete(armed.id);
      return;
    }
    if (matchesKey(data, "ctrl+n")) return this.cb.onNew();
    if (this.empty) {
      if (matchesKey(data, "escape")) this.cb.onClose();
      return;
    }
    if (data === "x") {
      const item = this.list!.getSelectedItem();
      if (item) this.armed = { id: item.value, label: item.label };
      return;
    }
    this.list!.handleInput(data);
  }

  render(width: number): string[] {
    const th = this.theme;
    const box = new Box(1, 1, (t) => th.bg("customMessageBg", t));
    box.addChild(new Text(`${th.fg("accent", "btw ▸ threads")}${th.fg("dim", "   Ctrl+N new | x delete | Esc close")}`, 0, 0));
    if (this.armed) {
      const label = this.armed.label.length > 40 ? `${this.armed.label.slice(0, 39)}…` : this.armed.label;
      box.addChild(new Text(th.fg("error", `delete "${label}"? x to confirm, any other key cancels`), 0, 0));
    } else {
      box.addChild(new Text("", 0, 0));
    }
    if (this.empty) {
      box.addChild(new Text(th.fg("dim", "no threads yet. Ctrl+N to start one"), 0, 0));
      return box.render(width);
    }
    for (const line of this.list!.render(width - 2)) box.addChild(new Text(line, 0, 0));
    return box.render(width);
  }

  invalidate(): void {
    this.list?.invalidate();
  }
}

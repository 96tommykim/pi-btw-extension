import type { Theme } from "@earendil-works/pi-coding-agent";

/** pi-core keybinding-hint convention: dim key + muted description. */
export function hintLine(th: Theme, pairs: Array<[string, string]>): string {
  return " " + pairs.map(([k, d]) => th.fg("dim", k) + th.fg("muted", ` ${d}`)).join("  ");
}

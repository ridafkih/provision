import { existsSync } from "node:fs";
import { out, sh } from "../core/shell";

export type Domain = "system" | "gui";

export const PLIST_DIRS: Record<Domain, string> = {
  system: "/System/Library/LaunchDaemons",
  gui: "/System/Library/LaunchAgents",
};

export interface DomainState {
  /** Overrides from `launchctl print-disabled`: true = disabled, false = explicitly enabled. */
  overrides: Map<string, boolean>;
  /** Loaded services and their pid (0 when loaded but not running). */
  loaded: Map<string, number>;
}

export interface LaunchdState {
  system: DomainState;
  gui: DomainState;
  target(domain: Domain): string;
  /** Path of the plist that defines `label`, or null if this macOS doesn't ship it. */
  plist(label: string, domain: Domain): Promise<string | null>;
}

export function parseOverrides(text: string): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const m of text.matchAll(/"([^"]+)"\s*=>\s*(disabled|enabled|true|false)/g)) {
    map.set(m[1]!, m[2] === "disabled" || m[2] === "true");
  }
  return map;
}

export function parseServices(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const start = text.indexOf("services = {");
  if (start < 0) return map;
  const block = text.slice(start, text.indexOf("\n\t}", start));
  for (const line of block.split("\n").slice(1)) {
    const m = line.trim().match(/^(\d+|-)\s+(\S+)\s+(\S+)$/);
    if (m) map.set(m[3]!, m[1] === "-" ? 0 : Number(m[1]));
  }
  return map;
}

/** Labels whose plist filename differs from the label, discovered on demand. */
const labelIndex: Partial<Record<Domain, Promise<Map<string, string>>>> = {};

async function buildIndex(domain: Domain): Promise<Map<string, string>> {
  // One sequential loop: spawning a plutil per file in parallel exhausts the process table.
  const script = 'for f in "$1"/*.plist; do printf "%s\\t" "$f"; plutil -extract Label raw -o - "$f" 2>/dev/null; echo; done';
  const text = await out(["/bin/sh", "-c", script, "sh", PLIST_DIRS[domain]]);
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [path, label] = line.split("\t");
    if (path && label) map.set(label, path);
  }
  return map;
}

export async function readLaunchd(uid: number): Promise<LaunchdState> {
  const gui = `gui/${uid}`;
  const [sysDisabled, guiDisabled, sysPrint, guiPrint] = await Promise.all([
    sh(["launchctl", "print-disabled", "system"]),
    sh(["launchctl", "print-disabled", gui]),
    sh(["launchctl", "print", "system"]),
    sh(["launchctl", "print", gui]),
  ]);

  return {
    system: { overrides: parseOverrides(sysDisabled.stdout), loaded: parseServices(sysPrint.stdout) },
    gui: { overrides: parseOverrides(guiDisabled.stdout), loaded: parseServices(guiPrint.stdout) },
    target: (domain) => (domain === "system" ? "system" : guiPrint.code === 0 ? gui : `user/${uid}`),
    async plist(label, domain) {
      const direct = `${PLIST_DIRS[domain]}/${label}.plist`;
      if (existsSync(direct)) return direct;
      labelIndex[domain] ??= buildIndex(domain);
      return (await labelIndex[domain]).get(label) ?? null;
    },
  };
}

import { existsSync } from "node:fs";
import type { Domain } from "../core/launchd";
import { out } from "../core/sh";
import { summarize, type Env, type Item, type Step, type Task } from "../core/task";

type Meta = Omit<Task, "inspect" | "labels">;

/** Disable and stop a set of launchd jobs. Undo re-enables and reloads them. */
export function services(meta: Meta & { daemons?: string[]; agents?: string[] }): Task {
  const entries: [Domain, string][] = [
    ...(meta.daemons ?? []).map((l) => ["system", l] as [Domain, string]),
    ...(meta.agents ?? []).map((l) => ["gui", l] as [Domain, string]),
  ];
  return {
    ...meta,
    needs: { sipOff: true, ...meta.needs },
    labels: entries.map(([, l]) => l),
    async inspect({ launchd }: Env) {
      const items: Item[] = [];
      const apply: Step[] = [];
      const undo: Step[] = [];
      for (const [domain, label] of entries) {
        const name = domain === "system" ? label : `${label} (agent)`;
        const path = await launchd.plist(label, domain);
        if (!path) {
          items.push({ name, state: "absent", note: "not shipped on this macOS" });
          continue;
        }
        const service = `${launchd.target(domain)}/${label}`;
        const pid = launchd[domain].loaded.get(label);
        const running = pid ? `running, pid ${pid}` : pid === 0 ? "loaded" : undefined;
        if (launchd[domain].overrides.get(label) === true) {
          items.push({ name, state: "done", note: running ? `disabled but still ${running}` : undefined });
          if (pid !== undefined) apply.push({ argv: ["launchctl", "bootout", service], tolerate: true });
          continue;
        }
        items.push({ name, state: "todo", note: running });
        apply.push({ argv: ["launchctl", "disable", service] });
        apply.push({ argv: ["launchctl", "bootout", service], tolerate: true });
        undo.push({ argv: ["launchctl", "enable", service] });
        undo.push({ argv: ["launchctl", "bootstrap", launchd.target(domain), path], tolerate: true });
      }
      return { state: summarize(items), items, apply, undo };
    },
  };
}

type PrefValue = boolean | number | string;

function encode(value: PrefValue): string {
  return typeof value === "boolean" ? (value ? "1" : "0") : String(value);
}

function writeArgs(value: PrefValue): string[] {
  if (typeof value === "boolean") return ["-bool", String(value)];
  if (typeof value === "number") return [Number.isInteger(value) ? "-int" : "-float", String(value)];
  return ["-string", value];
}

const TYPE_FLAGS: Record<string, string> = { boolean: "-bool", integer: "-int", float: "-float", string: "-string" };

/**
 * Set `defaults` keys. `system` writes as root to a system domain, `user` to the
 * target user's domain, `host` to the user's -currentHost (ByHost) domain.
 */
export function prefs(
  meta: Meta & {
    scope: "system" | "user" | "host";
    set: { domain: string; key: string; value: PrefValue }[];
    /** Writes may be refused (e.g. TCC-protected domains); don't fail the run. */
    tolerant?: boolean;
  },
): Task {
  const host = meta.scope === "host" ? ["-currentHost"] : [];
  const asUser = meta.scope !== "system";
  return {
    ...meta,
    async inspect({ exec }: Env) {
      const items: Item[] = [];
      const apply: Step[] = [];
      const undo: Step[] = [];
      for (const { domain, key, value } of meta.set) {
        const name = `${domain.split("/").pop()} ${key}`;
        const read = await exec({ argv: ["defaults", ...host, "read", domain, key], asUser });
        const current = read.code === 0 ? read.stdout.trim() : null;
        if (current === encode(value)) {
          items.push({ name, state: "done" });
          continue;
        }
        items.push({ name, state: "todo", note: `${current ?? "unset"} → ${encode(value)}` });
        apply.push({ argv: ["defaults", ...host, "write", domain, key, ...writeArgs(value)], asUser, tolerate: meta.tolerant });
        if (current === null) {
          undo.push({ argv: ["defaults", ...host, "delete", domain, key], asUser, tolerate: true });
        } else {
          const type = (await exec({ argv: ["defaults", ...host, "read-type", domain, key], asUser })).stdout.trim().split(" ").pop() ?? "";
          const flag = TYPE_FLAGS[type];
          if (flag) {
            const prev = flag === "-bool" ? (current === "1" ? "true" : "false") : current;
            undo.push({ argv: ["defaults", ...host, "write", domain, key, flag, prev], asUser, tolerate: true });
          }
        }
      }
      return { state: summarize(items), items, apply, undo };
    },
  };
}

export function parsePmset(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = line.match(/^\s+(\w+)\s+(\d+)/);
    if (m) map.set(m[1]!, Number(m[2]));
  }
  return map;
}

/** Set power-management values for all power sources. */
export function power(meta: Meta & { set: Record<string, number> }): Task {
  return {
    ...meta,
    async inspect() {
      const current = parsePmset(await out(["pmset", "-g"]));
      const items: Item[] = [];
      const apply: Step[] = [];
      const undo: Step[] = [];
      for (const [key, value] of Object.entries(meta.set)) {
        const now = current.get(key);
        if (now === undefined) items.push({ name: key, state: "absent", note: "not supported on this Mac" });
        else if (now === value) items.push({ name: key, state: "done" });
        else {
          items.push({ name: key, state: "todo", note: `${now} → ${value}` });
          apply.push({ argv: ["pmset", "-a", key, String(value)] });
          undo.push({ argv: ["pmset", "-a", key, String(now)] });
        }
      }
      return { state: summarize(items), items, apply, undo };
    },
  };
}

/** Delete files or bundles. Irreversible: restore can't bring them back. */
export function remove(meta: Meta & { paths: string[] }): Task {
  return {
    ...meta,
    irreversible: true,
    async inspect() {
      const items: Item[] = [];
      const apply: Step[] = [];
      for (const path of meta.paths) {
        if (!existsSync(path)) {
          items.push({ name: path, state: "absent" });
          continue;
        }
        const kb = Number((await out(["du", "-sk", path])).split("\t")[0]) || 0;
        items.push({ name: path, state: "todo", note: formatSize(kb * 1024) });
        apply.push({ argv: ["rm", "-rf", path] });
      }
      // Nothing left to remove counts as done, not "not applicable".
      const state = items.length && items.every((i) => i.state === "absent") ? "done" : summarize(items);
      return { state, items, apply, undo: [] };
    },
  };
}

export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i < 2 ? 0 : 1)} ${units[i]}`;
}

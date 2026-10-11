import type { Context } from "./context";
import type { LaunchdState } from "./launchd";
import type { Result } from "../core/shell";

export interface Step {
  argv: string[];
  /** Run in the target user's context (their defaults domains, their gui/<uid>). */
  asUser?: boolean;
  /** Failure is expected and harmless, e.g. booting out a job that isn't loaded. */
  tolerate?: boolean;
  /** Shown in plans instead of the argv, e.g. for steps that carry a whole file. */
  display?: string;
}

export type Tier = "lean" | "host" | "max";
export const TIERS: Tier[] = ["lean", "host", "max"];

export const GROUPS = {
  telemetry: "Telemetry & diagnostics",
  ai: "Apple Intelligence",
  siri: "Siri & speech",
  knowledge: "Suggestions & knowledge",
  media: "Photos, music & media",
  consumer: "Consumer apps & widgets",
  communication: "Mail, Messages & calls",
  icloud: "iCloud",
  continuity: "Continuity & AirPlay",
  desktop: "Desktop shell",
  hardware: "Hardware",
  network: "Enterprise & network services",
  spotlight: "Spotlight",
  host: "Host behaviour",
  storage: "Storage",
} as const;
export type Group = keyof typeof GROUPS;

export type State = "done" | "todo" | "partial" | "absent";

export interface Item {
  name: string;
  state: "done" | "todo" | "absent";
  note?: string;
}

export interface Inspection {
  state: State;
  items: Item[];
  apply: Step[];
  /** Steps that put back exactly what `apply` changes, captured before applying. */
  undo: Step[];
}

export interface Env {
  ctx: Context;
  launchd: LaunchdState;
  exec(step: Step): Promise<Result>;
}

export interface Task {
  id: string;
  group: Group;
  title: string;
  summary: string;
  /** The lightest profile that includes this task. */
  tier: Tier;
  /** What stops working. Shown before applying. */
  caveat?: string;
  /** Can't be undone by `restore` (e.g. deleted files). */
  irreversible?: boolean;
  needs?: { sipOff?: boolean };
  /** Every launchd label this task touches, so the guard can vet it. */
  labels?: string[];
  inspect(env: Env): Promise<Inspection>;
}

export function summarize(items: Item[]): State {
  const live = items.filter((i) => i.state !== "absent");
  if (live.length === 0) return "absent";
  const done = live.filter((i) => i.state === "done").length;
  return done === live.length ? "done" : done === 0 ? "todo" : "partial";
}

export function inProfile(task: Task, profile: Tier): boolean {
  return TIERS.indexOf(task.tier) <= TIERS.indexOf(profile);
}

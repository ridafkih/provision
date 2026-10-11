import { detect, type Context } from "./context";
import { loadJournal, pending, saveJournal } from "./journal";
import { readLaunchd } from "./launchd";
import { measure } from "./measure";
import { quote, sh } from "../core/shell";
import type { Env, Inspection, Step, Task } from "./task";

export async function openEnv(ctx?: Context): Promise<Env> {
  ctx ??= await detect();
  const launchd = await readLaunchd(ctx.uid);
  const env: Env = { ctx, launchd, exec: (step) => sh(argvFor(step, ctx)) };
  return env;
}

/** Steps marked asUser run inside the user's bootstrap namespace when we're root. */
export function argvFor(step: Step, ctx: Context): string[] {
  if (!step.asUser || !ctx.isRoot || ctx.uid === 0) return step.argv;
  return ["launchctl", "asuser", String(ctx.uid), "sudo", "-u", ctx.user, ...step.argv];
}

export function describe(step: Step): string {
  return `${step.display ?? quote(step.argv)}${step.asUser ? "   # as user" : ""}${step.tolerate ? "   # may fail" : ""}`;
}

export async function inspectAll(env: Env, tasks: Task[]): Promise<Map<string, Inspection>> {
  const results = await Promise.all(tasks.map(async (t) => [t.id, await t.inspect(env)] as const));
  return new Map(results);
}

export type LogKind = "task" | "step" | "ok" | "fail" | "skip" | "info";
export type Log = (kind: LogKind, text: string) => void;

export interface RunOptions {
  dryRun: boolean;
  log: Log;
}

export interface RunSummary {
  changed: number;
  skipped: number;
  failed: number;
}

/** Why a task can't run in this environment, or null if it can. */
export function blocker(task: Task, ctx: Context): string | null {
  if (task.needs?.sipOff && ctx.sip) return "needs SIP disabled — protected jobs would respawn";
  return null;
}

async function run(steps: Step[], env: Env, { dryRun, log }: RunOptions): Promise<boolean> {
  for (const step of steps) {
    log("step", describe(step));
    if (dryRun) continue;
    const r = await env.exec(step);
    if (r.code !== 0 && !step.tolerate) {
      log("fail", (r.stderr || r.stdout).trim() || `exit ${r.code}`);
      return false;
    }
  }
  return true;
}

export async function applyTasks(
  env: Env,
  tasks: Task[],
  inspections: Map<string, Inspection>,
  opts: RunOptions,
): Promise<RunSummary> {
  const { ctx } = env;
  if (!opts.dryRun && !ctx.isRoot) throw new Error("applying changes needs root — re-run with sudo");

  const journal = opts.dryRun ? null : await loadJournal();
  if (journal && !journal.baseline) {
    journal.baseline = await measure(env.launchd);
    await saveJournal(journal);
  }

  const summary: RunSummary = { changed: 0, skipped: 0, failed: 0 };
  for (const task of tasks) {
    const inspection = inspections.get(task.id);
    if (!inspection || inspection.apply.length === 0) {
      summary.skipped++;
      continue;
    }
    const blocked = blocker(task, ctx);
    if (blocked) {
      opts.log("skip", `${task.title}: ${blocked}`);
      summary.skipped++;
      continue;
    }
    opts.log("task", task.title);
    const ok = await run(inspection.apply, env, opts);
    if (journal && inspection.undo.length) {
      // Record undo even on partial failure: re-enabling something never disabled is harmless.
      journal.entries.push({ task: task.id, at: new Date().toISOString(), macos: ctx.build, undo: inspection.undo });
      await saveJournal(journal);
    }
    if (ok) summary.changed++;
    else summary.failed++;
  }
  return summary;
}

export async function restoreTasks(env: Env, only: Set<string> | undefined, opts: RunOptions): Promise<RunSummary> {
  if (!opts.dryRun && !env.ctx.isRoot) throw new Error("restoring needs root — re-run with sudo");
  const journal = await loadJournal();
  const summary: RunSummary = { changed: 0, skipped: 0, failed: 0 };
  for (const entry of pending(journal, only)) {
    opts.log("task", `${entry.task}  (applied ${entry.at.slice(0, 16).replace("T", " ")})`);
    const ok = await run(entry.undo, env, opts);
    if (opts.dryRun) continue;
    if (ok) {
      entry.restoredAt = new Date().toISOString();
      summary.changed++;
    } else summary.failed++;
    await saveJournal(journal);
  }
  return summary;
}

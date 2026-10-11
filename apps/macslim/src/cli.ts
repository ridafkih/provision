#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { TASKS } from "./catalog";
import { PROTECTED, PROTECTED_PREFIXES } from "./catalog/protect";
import { applyTasks, blocker, describe, inspectAll, openEnv, restoreTasks, type Log } from "./core/engine";
import { JOURNAL_PATH, loadJournal, pending } from "./core/journal";
import { measure, type Metrics } from "./core/measure";
import { parseTier, select } from "./core/select";
import { GROUPS, type Inspection, type Task } from "./core/task";

const HELP = `macslim — strip macOS down to a VM / simulator / CI host

Usage
  macslim                     interactive TUI (when run in a terminal)
  macslim status              state of every task, plus host metrics
  macslim plan                dry run: every command apply would execute
  macslim apply               apply the selected profile (needs sudo)
  macslim restore             undo everything macslim changed (needs sudo)
  macslim show <task>         details and per-service state for one task
  macslim measure             processes, memory, running jobs, disk
  macslim protected           services macslim will never touch

Selection (status, plan, apply)
  -p, --profile <lean|host|max>   default: host
      --only <a,b>                task ids or groups, instead of a profile
      --except <a,b>              drop task ids or groups

Options
  -y, --yes        don't ask for confirmation
  -n, --dry-run    print what would run without changing anything
      --json       machine-readable output (status, measure)

The journal of applied changes lives at ${JOURNAL_PATH}.
`;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { dim: paint(2), bold: paint(1), red: paint(31), green: paint(32), yellow: paint(33), cyan: paint(36) };

const STATE_LABEL: Record<Inspection["state"], string> = {
  done: c.green("✓ done   "),
  todo: c.yellow("○ todo   "),
  partial: c.yellow("◐ partial"),
  absent: c.dim("– n/a    "),
};

const cliLog: Log = (kind, text) => {
  const prefix = { task: c.bold("▸ "), step: c.dim("    $ "), ok: c.green("    ✓ "), fail: c.red("    ✗ "), skip: c.yellow("  ! "), info: "  " }[kind];
  console.log(prefix + (kind === "task" ? c.bold(text) : kind === "step" ? c.dim(text) : text));
};

function list(value: string | undefined): string[] | undefined {
  return value?.split(",").map((s) => s.trim()).filter(Boolean);
}

function confirm(question: string, yes: boolean): boolean {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new Error("refusing to continue without a terminal — pass --yes");
  return /^y(es)?$/i.test(prompt(`${question} [y/N]`) ?? "");
}

const delta = (a: number, b: number | undefined, unit = "") =>
  b === undefined || a === b ? "" : c.dim(`  (${a - b > 0 ? "+" : ""}${Math.round((a - b) * 10) / 10}${unit} since first apply)`);

function printMetrics(now: Metrics, baseline?: Metrics) {
  console.log(`  processes     ${now.processes}${delta(now.processes, baseline?.processes)}`);
  console.log(`  resident mem  ${now.rssMB} MB${delta(now.rssMB, baseline?.rssMB, " MB")}`);
  console.log(`  running jobs  ${now.runningJobs}${delta(now.runningJobs, baseline?.runningJobs)}`);
  console.log(`  disk free     ${now.diskFreeGB} GB${delta(now.diskFreeGB, baseline?.diskFreeGB, " GB")}`);
}

function printPlan(tasks: Task[], inspections: Map<string, Inspection>, ctx: Parameters<typeof blocker>[1]) {
  let steps = 0;
  for (const task of tasks) {
    const ins = inspections.get(task.id)!;
    if (!ins.apply.length) continue;
    const blocked = blocker(task, ctx);
    console.log(`${c.bold("▸ " + task.title)} ${c.dim(`[${task.id}]`)}${task.irreversible ? c.red("  irreversible") : ""}`);
    if (blocked) console.log(c.yellow(`  ! skipped: ${blocked}`));
    if (task.caveat) console.log(c.yellow(`  ⚠ ${task.caveat}`));
    for (const step of ins.apply) console.log(c.dim(`    $ ${describe(step)}`));
    steps += ins.apply.length;
  }
  return steps;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: "string", short: "p" },
      only: { type: "string" },
      except: { type: "string" },
      yes: { type: "boolean", short: "y" },
      "dry-run": { type: "boolean", short: "n" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command = process.stdout.isTTY ? "tui" : "help", ...rest] = positionals;
  const selection = { profile: parseTier(values.profile), only: list(values.only), except: list(values.except) };

  switch (command) {
    case "help":
      console.log(HELP);
      return;

    case "tui": {
      const { runTui } = await import("./tui/run");
      await runTui(selection.profile);
      return;
    }

    case "protected": {
      for (const [label, why] of Object.entries(PROTECTED)) console.log(`${label.padEnd(48)} ${c.dim(why)}`);
      for (const [prefix, why] of Object.entries(PROTECTED_PREFIXES)) console.log(`${(prefix + "*").padEnd(48)} ${c.dim(why)}`);
      console.log(`${"(anything not com.apple.*)".padEnd(48)} ${c.dim("third-party services, e.g. Tailscale")}`);
      return;
    }

    case "measure": {
      const env = await openEnv();
      const [now, journal] = await Promise.all([measure(env.launchd), loadJournal()]);
      if (values.json) console.log(JSON.stringify({ now, baseline: journal.baseline }, null, 2));
      else printMetrics(now, journal.baseline);
      return;
    }

    case "status": {
      const env = await openEnv();
      const tasks = select(TASKS, selection);
      const [inspections, now, journal] = await Promise.all([inspectAll(env, tasks), measure(env.launchd), loadJournal()]);
      if (values.json) {
        const out = tasks.map((t) => ({ id: t.id, group: t.group, tier: t.tier, ...inspections.get(t.id)! }));
        console.log(JSON.stringify({ host: env.ctx, metrics: now, tasks: out }, null, 2));
        return;
      }
      const { ctx } = env;
      console.log(`${c.bold(ctx.model)}  macOS ${ctx.os} (${ctx.build})  SIP ${ctx.sip ? c.yellow("on") : c.green("off")}`);
      printMetrics(now, journal.baseline);
      console.log(c.dim(`\nprofile: ${selection.profile}   applied & restorable: ${pending(journal).length}\n`));
      let group = "";
      for (const task of tasks) {
        if (task.group !== group) {
          group = task.group;
          console.log(c.cyan(GROUPS[task.group]));
        }
        const ins = inspections.get(task.id)!;
        const live = ins.items.filter((i) => i.state !== "absent");
        const count = live.length > 1 ? c.dim(` ${live.filter((i) => i.state === "done").length}/${live.length}`) : "";
        console.log(`  ${STATE_LABEL[ins.state]} ${task.title}${count} ${c.dim(`[${task.id}]`)}`);
      }
      return;
    }

    case "show": {
      const task = TASKS.find((t) => t.id === rest[0]);
      if (!task) throw new Error(`usage: macslim show <task>  (one of: ${TASKS.map((t) => t.id).join(", ")})`);
      const env = await openEnv();
      const ins = await task.inspect(env);
      console.log(`${c.bold(task.title)} ${c.dim(`[${task.id}] · ${GROUPS[task.group]} · profile ${task.tier}+`)}`);
      console.log(task.summary);
      if (task.caveat) console.log(c.yellow(`⚠ ${task.caveat}`));
      console.log();
      for (const item of ins.items) {
        const mark = item.state === "done" ? c.green("✓") : item.state === "todo" ? c.yellow("○") : c.dim("–");
        console.log(`  ${mark} ${item.name}${item.note ? c.dim(`  ${item.note}`) : ""}`);
      }
      return;
    }

    case "plan":
    case "apply": {
      const dryRun = command === "plan" || !!values["dry-run"];
      const env = await openEnv();
      if (!dryRun && !env.ctx.isRoot) throw new Error("apply needs root — run: sudo macslim apply");
      const tasks = select(TASKS, selection);
      const inspections = await inspectAll(env, tasks);
      const steps = printPlan(tasks, inspections, env.ctx);
      if (!steps) {
        console.log(c.green("Nothing to do — everything in this selection is already applied."));
        return;
      }
      console.log(c.dim(`\n${steps} commands across ${tasks.filter((t) => inspections.get(t.id)!.apply.length).length} tasks.`));
      if (dryRun) {
        console.log(c.dim(`Dry run. Apply with: sudo macslim apply${values.profile ? ` -p ${values.profile}` : ""}`));
        return;
      }
      if (!confirm("\nApply these changes?", !!values.yes)) return;
      console.log();
      const quiet: Log = (kind, text) => kind !== "step" && cliLog(kind, text);
      const summary = await applyTasks(env, tasks, inspections, { dryRun: false, log: quiet });
      console.log(`\n${c.green(`${summary.changed} applied`)}, ${summary.failed ? c.red(`${summary.failed} failed`) : "0 failed"}.`);
      console.log(c.dim("Reboot to clear jobs that were already running. Undo any time with: sudo macslim restore"));
      if (summary.failed) process.exitCode = 1;
      return;
    }

    case "restore": {
      const dryRun = !!values["dry-run"];
      const env = await openEnv();
      const only = values.only ? new Set(list(values.only)) : undefined;
      const entries = pending(await loadJournal(), only);
      if (!entries.length) {
        console.log("Nothing to restore.");
        return;
      }
      console.log(`${entries.length} journal entries to undo:\n`);
      await restoreTasks(env, only, { dryRun: true, log: cliLog });
      if (dryRun) return;
      if (!env.ctx.isRoot) throw new Error("restore needs root — run: sudo macslim restore");
      if (!confirm("\nRestore these?", !!values.yes)) return;
      const summary = await restoreTasks(env, only, { dryRun: false, log: (k, t) => k !== "step" && cliLog(k, t) });
      console.log(`\n${summary.changed} restored, ${summary.failed} failed. Reboot to bring every service back.`);
      if (summary.failed) process.exitCode = 1;
      return;
    }

    default:
      console.error(`unknown command: ${command}\n`);
      console.log(HELP);
      process.exitCode = 2;
  }
}

main().catch((err: Error) => {
  console.error(c.red(`macslim: ${err.message}`));
  process.exitCode = 1;
});


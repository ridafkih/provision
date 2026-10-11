import { say, unchanged } from "../../core/output";
import { run, type Machine } from "../../core/shell";
import { TASKS } from "../../slim/catalog";
import { blocker, inspectAll, openEnv } from "../../slim/engine";
import { select } from "../../slim/select";
import type { Context } from "../../slim/context";
import { loadJournal, pending, type Journal } from "../../slim/journal";
import { TIERS, type Inspection, type State, type Task, type Tier } from "../../slim/task";
import type { Setup, SetupStep } from "../context";
import { hasRole } from "../options";
import { isListening } from "../system";
import { autoLoginUser, fileVaultStatus } from "./unattended-boot";
import { isOnTailnet } from "./tailscale";

export const slimProfileFor = ({ options }: Setup): Tier => (hasRole(options, "runner") || hasRole(options, "worker") ? "host" : "lean");

export function unconfirmedRemoteAccess(machine: Machine) {
  const missing: string[] = [];
  if (!isListening(machine, 22)) missing.push("SSH is not listening");
  if (fileVaultStatus(machine) !== "FileVault is Off.") missing.push("FileVault is not off");
  if (autoLoginUser(machine) !== machine.user) missing.push(`automatic login is not set to ${machine.user}`);
  if (!isOnTailnet(machine)) missing.push("this Mac is not on the tailnet");
  return missing;
}

export type SlimState = { pending: string[]; waitingForSip: string[] };

const isOpen = (state: State) => state === "todo" || state === "partial";

export function slimStateOf(tasks: Task[], inspections: Map<string, Inspection>, context: Context): SlimState {
  const open = tasks.filter((task) => isOpen(inspections.get(task.id)?.state ?? "absent"));
  return {
    pending: open.filter((task) => !blocker(task, context)).map((task) => task.id),
    waitingForSip: open.filter((task) => blocker(task, context)).map((task) => task.id),
  };
}

export async function slimState(profile: Tier): Promise<SlimState> {
  const environment = await openEnv();
  const tasks = select(TASKS, { profile });
  return slimStateOf(tasks, await inspectAll(environment, tasks), environment.ctx);
}

export const appliedProfile = (journal: Journal): Tier | undefined => {
  const appliedTiers = new Set(pending(journal).flatMap((entry) => TASKS.filter((task) => task.id === entry.task).map((task) => task.tier)));
  return TIERS.toReversed().find((tier) => appliedTiers.has(tier));
};

export const expectedSlimProfile = (setup: Setup, journal: Journal): Tier => {
  const forRole = slimProfileFor(setup);
  const applied = appliedProfile(journal);
  return applied && TIERS.indexOf(applied) > TIERS.indexOf(forRole) ? applied : forRole;
};

export const selfCommand = () => (Bun.main.startsWith("/$bunfs/") ? [process.execPath] : [process.execPath, Bun.main]);

export const slim: SetupStep = {
  id: "slim",
  title: "Slim",
  async apply(setup) {
    const { machine, options } = setup;
    if (options.isSlimSkipped) return say(machine, "skipped: --no-slim");
    const missing = unconfirmedRemoteAccess(machine);
    if (missing.length > 0) return say(machine, `skipped: slimming waits until remote access is confirmed (${missing.join("; ")}); run provision again`);
    const profile = slimProfileFor(setup);
    const state = await slimState(profile);
    if (state.pending.length === 0) return unchanged(machine, `slimmed to the ${profile} profile`);
    const result = run(machine, ["sudo", "-n", ...selfCommand(), "slim", "apply", "--profile", profile, "--yes"], { isInteractive: true });
    say(machine, result.code === 0 ? `slimmed to the ${profile} profile` : `slimming finished with failures; see above, then run provision again`);
  },
  async check(setup, checklist) {
    if (setup.options.isSlimSkipped) return checklist.note("Slimming skipped (--no-slim)");
    const profile = expectedSlimProfile(setup, await loadJournal());
    const state = await slimState(profile);
    if (state.pending.length > 0) checklist.miss(`Slimmed to the ${profile} profile`, `rerun provision (still to do: ${state.pending.join(", ")})`);
    else checklist.pass(`Slimmed to the ${profile} profile`);
    if (state.waitingForSip.length > 0)
      checklist.note(`${state.waitingForSip.length} slim task(s) only stick with SIP off and stay as they are: ${state.waitingForSip.join(", ")}`);
  },
};

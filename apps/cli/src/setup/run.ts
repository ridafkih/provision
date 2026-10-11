import { readlinkSync } from "node:fs";
import { createChecklist, renderChecklist, verdictOf, type Checklist } from "../core/checklist";
import { changed, fail, heading, say, unchanged } from "../core/output";
import { output, sudo, type Machine } from "../core/shell";
import type { Setup, SetupStep } from "./context";
import { collectCredentials, forgetPassword } from "./credentials";
import { installBinary, installedBinary, repairProvisionHome } from "./home";
import { requireNameResolution } from "./name-resolution";
import { saveArguments } from "./options";
import { applyRunnerRole, checkRunnerRole } from "./roles/runner";
import { applyWorkerRole, checkWorkerRole } from "./roles/worker";
import { firewall } from "./steps/firewall";
import { headless } from "./steps/headless";
import { homebrew } from "./steps/homebrew";
import { hostname } from "./steps/hostname";
import { network } from "./steps/network";
import { passwordlessSudo } from "./steps/passwordless-sudo";
import { sendNotification } from "./steps/notify";
import { power } from "./steps/power";
import { privacy } from "./steps/privacy";
import { privacyGrants } from "./steps/privacy-grants";
import { sharing } from "./steps/sharing";
import { slim } from "./steps/slim";
import { fetchPublicKeys, ssh } from "./steps/ssh";
import { tailscale } from "./steps/tailscale";
import { needsUnattendedBootPassword, unattendedBoot } from "./steps/unattended-boot";
import { updates } from "./steps/updates";

const roles: SetupStep = {
  id: "roles",
  title: "Roles",
  apply(setup) {
    for (const role of setup.options.roles) {
      heading(setup.machine, `Role: ${role}`);
      if (role === "runner") applyRunnerRole(setup);
      else applyWorkerRole(setup);
    }
  },
  check(setup, checklist) {
    for (const role of setup.options.roles) {
      if (role === "runner") checkRunnerRole(setup, checklist);
      else checkWorkerRole(setup, checklist);
    }
  },
};

const firewallThenResolve: SetupStep = {
  ...firewall,
  async apply(setup) {
    await firewall.apply(setup);
    await requireNameResolution(setup.machine, "after the firewall step");
  },
};

const unattendedBootThenForget: SetupStep = {
  ...unattendedBoot,
  async apply(setup) {
    await unattendedBoot.apply(setup);
    forgetPassword();
  },
};

export const setupSteps: SetupStep[] = [
  passwordlessSudo,
  hostname,
  power,
  headless,
  updates,
  privacy,
  firewallThenResolve,
  ssh,
  sharing,
  unattendedBootThenForget,
  homebrew,
  roles,
  tailscale,
  privacyGrants,
  slim,
];

const checkOrder: SetupStep[] = [passwordlessSudo, power, headless, network, updates, privacy, firewall, sharing, ssh, unattendedBoot, homebrew, tailscale, roles, privacyGrants, slim];

function installCommand(machine: Machine, runningBinary: string) {
  installBinary(machine, runningBinary);
  const link = machine.paths.commandLink;
  const target = installedBinary(machine);
  const current = (() => {
    try {
      return readlinkSync(link);
    } catch {
      return "";
    }
  })();
  if (current === target) return unchanged(machine, `provision command at ${link}`);
  if (sudo(machine, ["install", "-d", "/usr/local/bin"]).code !== 0 || sudo(machine, ["ln", "-sf", target, link]).code !== 0)
    fail(`could not link ${link}`);
  changed(machine, `provision command at ${link}`);
}


export async function runChecks(setup: Setup) {
  const checklist = createChecklist();
  for (const step of checkOrder) await step.check?.(setup, checklist);
  return checklist;
}

export async function printReport(setup: Setup) {
  const checklist = await runChecks(setup);
  setup.machine.print(`\n\x1b[1mReady-to-rack checklist for ${output(setup.machine, ["scutil", "--get", "LocalHostName"])}\x1b[0m`);
  setup.machine.print(renderChecklist(checklist));
  setup.machine.print(verdictOf(checklist));
  return checklist;
}

export type ApplyRequest = { savedArguments: readonly string[]; runningBinary: string | undefined; onlySteps?: ReadonlySet<string> };

export async function applySetup(setup: Setup, { savedArguments, runningBinary, onlySteps }: ApplyRequest): Promise<Checklist> {
  const { machine } = setup;
  heading(machine, "Before anything changes");
  collectCredentials(machine, needsUnattendedBootPassword(machine));
  repairProvisionHome(machine);
  if (savedArguments.length > 0) saveArguments(machine.home, savedArguments);
  await requireNameResolution(machine, "before setup starts");
  fetchPublicKeys(setup);
  for (const step of setupSteps) {
    if (onlySteps && !onlySteps.has(step.id)) continue;
    if (step !== roles) heading(machine, step.title);
    await step.apply(setup);
  }
  forgetPassword();
  heading(machine, "provision command");
  if (runningBinary) installCommand(machine, runningBinary);
  else say(machine, "skipped: running from source, so nothing to install");
  const checklist = await printReport(setup);
  sendNotification(setup, checklist);
  return checklist;
}

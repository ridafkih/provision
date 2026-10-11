import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Checklist } from "../../core/checklist";
import { changed, fail, unchanged } from "../../core/output";
import { output, run, succeeds, sudo, type Machine } from "../../core/shell";
import type { Setup } from "../context";
import { installedKit } from "../home";
import { localHostName } from "../system";
import { runnerAgentTemplates, runnerKitFiles } from "./runner-kit";
import { applyWorkerRole, checkWorkerRole } from "./worker";

const vmCpuCount = 4;
const vmMemoryMb = 6144;
const hostReservedMemoryMb = 4096;
const maxSlots = 4;

const runnerDirectory = (machine: Machine) => join(machine.home, ".provision/runner");
const runnerLogDirectory = (machine: Machine) => join(machine.home, "Library/Logs/provision");
const agentsDirectory = (machine: Machine) => join(machine.home, "Library/LaunchAgents");
const runnerKit = (machine: Machine) => join(installedKit(machine), "roles/runner");

export function runnerSlotCount(machine: Machine) {
  const hostMemoryMb = Math.floor(Number(output(machine, ["sysctl", "-n", "hw.memsize"])) / 1024 / 1024);
  const hostCpuCount = Number(output(machine, ["sysctl", "-n", "hw.ncpu"]));
  const slots = Math.min(Math.floor((hostMemoryMb - hostReservedMemoryMb) / vmMemoryMb), maxSlots, Math.floor(hostCpuCount / 2));
  if (slots < 1) fail(`this Mac has ${hostMemoryMb} MB of memory, too little for one ${vmMemoryMb} MB runner VM`);
  return slots;
}

export function runnerConfig({ machine, options }: Setup) {
  return [
    "GITHUB_API_URL=https://api.github.com",
    `GITHUB_REPOSITORY=${options.runnerRepository}`,
    `RUNNER_NAME_PREFIX=${localHostName(machine).toLowerCase()}`,
    `RUNNER_LABELS=${["self-hosted", "Linux", "ARM64", ...options.runnerLabels].join(",")}`,
    "RUNNER_LIFETIME_SECONDS=21600",
    "LINUX_BASE_IMAGE=ghcr.io/cirruslabs/ubuntu-runner-arm64:24.04",
    "LINUX_GOLDEN_VM=runner-linux",
    `LINUX_SLOTS=${runnerSlotCount(machine)}`,
    `VM_CPU_COUNT=${vmCpuCount}`,
    `VM_MEMORY_MB=${vmMemoryMb}`,
    "VM_DISK_GB=80",
    "BAKE_MEMORY_MB=4096",
    "BAKE_MAX_AGE_DAYS=7",
    `PREPULL_IMAGES=${options.runnerPrepullImages.join(",")}`,
    "BOOT_TIMEOUT_SECONDS=180",
    "RETRY_DELAY_SECONDS=60",
    `CREDENTIALS_FILE=${runnerDirectory(machine)}/credentials.env`,
    `LOG_DIRECTORY=${runnerLogDirectory(machine)}`,
  ].join("\n");
}

export const renderRunnerAgent = (machine: Machine, template: string, label: string, slot: number) =>
  template
    .replaceAll("@LABEL@", label)
    .replaceAll("@KIT@", runnerKit(machine))
    .replaceAll("@SLOT@", String(slot))
    .replaceAll("@PATH@", "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin")
    .replaceAll("@HOME@", machine.home)
    .replaceAll("@LOGS@", runnerLogDirectory(machine));

const readIfPresent = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

function writeIfChanged(path: string, contents: string, mode: number) {
  if (readIfPresent(path) === contents) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode });
  chmodSync(path, mode);
  return true;
}

export function installRunnerKit(machine: Machine) {
  const kit = runnerKit(machine);
  const isChanged = Object.entries(runnerKitFiles)
    .map(([path, contents]) => writeIfChanged(join(kit, path), contents, path.startsWith("bin/") ? 0o755 : 0o644))
    .some(Boolean);
  if (isChanged) changed(machine, `runner scripts in ${kit}`);
  else unchanged(machine, `runner scripts in ${kit}`);
}

function ensureRunnerAgent(machine: Machine, label: string, contents: string) {
  const plist = join(agentsDirectory(machine), `${label}.plist`);
  const domain = `gui/${output(machine, ["id", "-u"])}`;
  if (readIfPresent(plist) === `${contents}\n` && succeeds(machine, ["launchctl", "print", `${domain}/${label}`])) {
    unchanged(machine, `${label} loaded`);
    return;
  }
  run(machine, ["launchctl", "bootout", `${domain}/${label}`]);
  writeFileSync(plist, `${contents}\n`);
  if (!succeeds(machine, ["plutil", "-lint", plist])) fail(`${plist} is not a valid property list`);
  if (!succeeds(machine, ["launchctl", "bootstrap", domain, plist])) fail(`launchctl could not load ${label}`);
  changed(machine, `${label} loaded`);
}

function removeExtraRunnerAgents(machine: Machine, slots: number) {
  const directory = agentsDirectory(machine);
  const uid = output(machine, ["id", "-u"]);
  for (const name of readdirSync(directory).filter((each) => /^dev\.provision\.runner-slot-\d+\.plist$/.test(each))) {
    const label = basename(name, ".plist");
    if (Number(label.split("-").pop()) <= slots) continue;
    run(machine, ["launchctl", "bootout", `gui/${uid}/${label}`]);
    rmSync(join(directory, name), { force: true });
    changed(machine, `${label} removed`);
  }
}

function ensureRunnerLogRotation(machine: Machine) {
  const rotationFile = "/etc/newsyslog.d/provision-runner.conf";
  const wanted = `${runnerLogDirectory(machine)}/*.log ${machine.user}:staff 644 5 10240 * GN`;
  if (readIfPresent(rotationFile)?.trim() === wanted) {
    unchanged(machine, "runner logs rotate at 10 MB, five kept");
    return;
  }
  sudo(machine, ["tee", rotationFile], { input: `${wanted}\n` });
  sudo(machine, ["chmod", "644", rotationFile]);
  changed(machine, "runner logs rotate at 10 MB, five kept");
}

const configuredSlots = (machine: Machine) => readIfPresent(join(runnerDirectory(machine), "runner.env"))?.match(/^LINUX_SLOTS=(.*)$/m)?.[1];

export function applyRunnerRole(setup: Setup) {
  const { machine, options } = setup;
  if (!options.runnerRepository) fail("--role runner needs --runner-repo <owner/repo>");
  applyWorkerRole(setup);
  mkdirSync(runnerDirectory(machine), { recursive: true, mode: 0o700 });
  for (const directory of [runnerLogDirectory(machine), agentsDirectory(machine)]) mkdirSync(directory, { recursive: true, mode: 0o755 });
  installRunnerKit(machine);
  const configFile = join(runnerDirectory(machine), "runner.env");
  if (writeIfChanged(configFile, `${runnerConfig(setup)}\n`, 0o644)) changed(machine, configFile);
  else unchanged(machine, configFile);
  ensureRunnerLogRotation(machine);
  const slots = Number(configuredSlots(machine));
  ensureRunnerAgent(machine, "dev.provision.runner-bake", renderRunnerAgent(machine, runnerAgentTemplates.bake, "dev.provision.runner-bake", 0).trimEnd());
  for (let slot = 1; slot <= slots; slot++) {
    const label = `dev.provision.runner-slot-${slot}`;
    ensureRunnerAgent(machine, label, renderRunnerAgent(machine, runnerAgentTemplates.slot, label, slot).trimEnd());
  }
  removeExtraRunnerAgents(machine, slots);
}

export function checkRunnerRole(setup: Setup, checklist: Checklist) {
  const { machine, options } = setup;
  checkWorkerRole(setup, checklist);
  const slots = configuredSlots(machine);
  if (slots) checklist.pass(`GitHub runner for ${options.runnerRepository}: ${slots} VM slots`);
  else checklist.miss("GitHub runner configured", "rerun provision --role runner --runner-repo <owner/repo>");
  const credentials = readIfPresent(join(runnerDirectory(machine), "credentials.env")) ?? "";
  if (/^GITHUB_RUNNER_TOKEN=.+/m.test(credentials)) checklist.pass("Runner token in place");
  else
    checklist.waitingOnOwner(
      "Runner token",
      `put GITHUB_RUNNER_TOKEN=<fine-grained token, Administration read and write on ${options.runnerRepository}> in ${runnerDirectory(machine)}/credentials.env (mode 600), then: launchctl kickstart -k gui/${output(machine, ["id", "-u"])}/dev.provision.runner-bake`,
    );
  if (existsSync(join(runnerDirectory(machine), "golden.env"))) checklist.pass("Runner VM image baked");
  else checklist.note("The runner VM image bakes once the token is in place (about 15 minutes)");
}

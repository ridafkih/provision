import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Checklist } from "../../core/checklist";
import { changed, fail, unchanged } from "../../core/output";
import { output, run, succeeds, sudo, type Machine } from "../../core/shell";
import type { Setup } from "../context";
import { installedKit } from "../home";
import { localHostName } from "../system";
import { runnerAgentTemplates, runnerKitFiles } from "./runner-kit";
import { applyRunnerFirewall, checkRunnerFirewall } from "./runner-firewall";
import { applyWorkerRole, checkWorkerRole } from "./worker";

const vmCpuCount = 4;
const vmMemoryMb = 6144;
const macosVmMemoryMb = 8192;
const hostReservedMemoryMb = 4096;
const maxSlots = 4;

const runnerDirectory = (machine: Machine) => join(machine.home, ".provision/runner");
const runnerLogDirectory = (machine: Machine) => join(machine.home, "Library/Logs/provision");
const agentsDirectory = (machine: Machine) => join(machine.home, "Library/LaunchAgents");
const runnerKit = (machine: Machine) => join(installedKit(machine), "roles/runner");

export const macosSlotCount = (options: Setup["options"]) => (options.runnerMacosImage ? 1 : 0);

export function runnerSlotCount(machine: Machine, macosSlots: number) {
  const hostMemoryMb = Math.floor(Number(output(machine, ["sysctl", "-n", "hw.memsize"])) / 1024 / 1024);
  const hostCpuCount = Number(output(machine, ["sysctl", "-n", "hw.ncpu"]));
  const linuxMemoryMb = hostMemoryMb - hostReservedMemoryMb - macosSlots * macosVmMemoryMb;
  const slots = Math.min(Math.floor(linuxMemoryMb / vmMemoryMb), maxSlots, Math.floor(hostCpuCount / 2) - macosSlots);
  if (slots < 1) {
    const macosNote = macosSlots > 0 ? ` beside a ${macosVmMemoryMb} MB macOS runner VM` : "";
    fail(`this Mac has ${hostMemoryMb} MB of memory, too little for one ${vmMemoryMb} MB Linux runner VM${macosNote}`);
  }
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
    `LINUX_SLOTS=${runnerSlotCount(machine, macosSlotCount(options))}`,
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
    `MACOS_SLOTS=${macosSlotCount(options)}`,
    `MACOS_BASE_IMAGE=${options.runnerMacosImage}`,
    "MACOS_GOLDEN_VM=runner-macos",
    `MACOS_RUNNER_LABELS=${["self-hosted", "macOS", "ARM64", ...options.runnerMacosLabels].join(",")}`,
    `MACOS_VM_MEMORY_MB=${macosVmMemoryMb}`,
  ].join("\n");
}

export type RunnerPool = "linux" | "macos";

export const slotAgentLabel = (pool: RunnerPool, slot: number) =>
  pool === "linux" ? `dev.provision.runner-slot-${slot}` : `dev.provision.runner-macos-slot-${slot}`;

const slotLogName = (pool: RunnerPool, slot: number) => (pool === "linux" ? `slot-${slot}` : `macos-slot-${slot}`);

export const renderRunnerAgent = (machine: Machine, template: string, label: string, slot: number, pool: RunnerPool) =>
  template
    .replaceAll("@LABEL@", label)
    .replaceAll("@KIT@", runnerKit(machine))
    .replaceAll("@POOL@", pool)
    .replaceAll("@LOG_NAME@", slotLogName(pool, slot))
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

const slotAgentPattern = { linux: /^dev\.provision\.runner-slot-\d+\.plist$/, macos: /^dev\.provision\.runner-macos-slot-\d+\.plist$/ } as const;

function removeExtraRunnerAgents(machine: Machine, pool: RunnerPool, slots: number) {
  const directory = agentsDirectory(machine);
  const uid = output(machine, ["id", "-u"]);
  for (const name of readdirSync(directory).filter((each) => slotAgentPattern[pool].test(each))) {
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

const configuredValue = (machine: Machine, key: string) =>
  readIfPresent(join(runnerDirectory(machine), "runner.env"))?.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];
const configuredSlots = (machine: Machine) => configuredValue(machine, "LINUX_SLOTS");

export function applyRunnerRole(setup: Setup) {
  const { machine, options } = setup;
  if (!options.runnerRepository) fail("--role runner needs --runner-repo <owner/repo>");
  applyWorkerRole(setup);
  applyRunnerFirewall(machine);
  mkdirSync(runnerDirectory(machine), { recursive: true, mode: 0o700 });
  for (const directory of [runnerLogDirectory(machine), agentsDirectory(machine)]) mkdirSync(directory, { recursive: true, mode: 0o755 });
  installRunnerKit(machine);
  const configFile = join(runnerDirectory(machine), "runner.env");
  if (writeIfChanged(configFile, `${runnerConfig(setup)}\n`, 0o644)) changed(machine, configFile);
  else unchanged(machine, configFile);
  ensureRunnerLogRotation(machine);
  ensureRunnerAgent(machine, "dev.provision.runner-bake", renderRunnerAgent(machine, runnerAgentTemplates.bake, "dev.provision.runner-bake", 0, "linux").trimEnd());
  const slotsByPool: Record<RunnerPool, number> = { linux: Number(configuredSlots(machine)), macos: macosSlotCount(options) };
  for (const pool of ["linux", "macos"] as const) {
    for (let slot = 1; slot <= slotsByPool[pool]; slot++) {
      const label = slotAgentLabel(pool, slot);
      ensureRunnerAgent(machine, label, renderRunnerAgent(machine, runnerAgentTemplates.slot, label, slot, pool).trimEnd());
    }
    removeExtraRunnerAgents(machine, pool, slotsByPool[pool]);
  }
}

export function checkRunnerRole(setup: Setup, checklist: Checklist) {
  const { machine, options } = setup;
  checkWorkerRole(setup, checklist);
  checkRunnerFirewall(machine, checklist);
  const slots = configuredSlots(machine);
  const macosSlots = Number(configuredValue(machine, "MACOS_SLOTS") ?? "0");
  const macosNote = macosSlots > 0 ? ` and ${macosSlots} macOS` : "";
  if (slots) checklist.pass(`GitHub runner for ${options.runnerRepository}: ${slots} Linux${macosNote} VM slots`);
  else checklist.miss("GitHub runner configured", "rerun provision --role runner --runner-repo <owner/repo>");
  const credentials = readIfPresent(join(runnerDirectory(machine), "credentials.env")) ?? "";
  if (/^GITHUB_RUNNER_TOKEN=.+/m.test(credentials)) checklist.pass("Runner token in place");
  else
    checklist.waitingOnOwner(
      "Runner token",
      `put GITHUB_RUNNER_TOKEN=<fine-grained token, Administration read and write on ${options.runnerRepository}> in ${runnerDirectory(machine)}/credentials.env (mode 600), then: launchctl kickstart -k gui/${output(machine, ["id", "-u"])}/dev.provision.runner-bake`,
    );
  if (existsSync(join(runnerDirectory(machine), "golden.env"))) checklist.pass("Linux runner VM image baked");
  else checklist.note("The Linux runner VM image bakes once the token is in place (about 15 minutes)");
  if (macosSlots > 0) {
    if (existsSync(join(runnerDirectory(machine), "golden-macos.env"))) checklist.pass("macOS runner VM image baked");
    else checklist.note("The macOS runner VM image bakes after the Linux one (a 70 GB download, about an hour)");
  }
}

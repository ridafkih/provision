import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { changed, say, unchanged } from "../../core/output";
import { run, sleep, type Machine } from "../../core/shell";
import type { SetupStep } from "../context";
import type { GrantKind } from "../options";

const systemTccDatabase = "/Library/Application Support/com.apple.TCC/TCC.db";
const grantWaitSeconds = 900;

const grantDetails: Record<GrantKind, { service: string; pane: string; title: string }> = {
  "full-disk-access": {
    service: "kTCCServiceSystemPolicyAllFiles",
    pane: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    title: "Full Disk Access",
  },
  "screen-recording": {
    service: "kTCCServiceScreenCapture",
    pane: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    title: "Screen & System Audio Recording",
  },
  accessibility: {
    service: "kTCCServiceAccessibility",
    pane: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    title: "Accessibility",
  },
};

export type Grant = { kind: GrantKind; path: string };
export type GrantState = "granted" | "absent" | "unreadable" | "missing";

const probeKey = (machine: Machine) => join(machine.home, ".provision/tcc-probe/id_ed25519");
const probeKnownHosts = (machine: Machine) => join(machine.home, ".provision/tcc-probe/known_hosts");

export function expandGrants(requestedGrants: readonly string[]): Grant[] {
  const expanded = requestedGrants.flatMap((grant) => {
    const separator = grant.indexOf(":");
    const kind = grant.slice(0, separator);
    const path = grant.slice(separator + 1);
    if (kind === "all") return Object.keys(grantDetails).map((each) => `${each}:${path}`);
    return [grant];
  });
  const unique = [...new Set(expanded)];
  const ordered = [...unique.filter((grant) => grant.startsWith("full-disk-access:")), ...unique.filter((grant) => !grant.startsWith("full-disk-access:"))];
  return ordered.map((grant) => {
    const separator = grant.indexOf(":");
    return { kind: grant.slice(0, separator) as GrantKind, path: grant.slice(separator + 1) };
  });
}

export function tccClientOf(machine: Machine, path: string) {
  if (!path.endsWith(".app")) return path;
  const result = run(machine, ["defaults", "read", `${path}/Contents/Info`, "CFBundleIdentifier"]);
  return result.code === 0 ? result.stdout.trim() : undefined;
}

const grantQuery = (service: string, client: string) => `SELECT auth_value FROM access WHERE service = '${service}' AND client = '${client}';`;

export function ensureTccProbeKey(machine: Machine) {
  const key = probeKey(machine);
  if (!existsSync(key)) {
    mkdirSync(dirname(key), { recursive: true, mode: 0o700 });
    run(machine, ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "provision tcc probe", "-f", key]);
  }
  const publicKey = readFileSync(`${key}.pub`, "utf8").trim();
  const authorizedKeys = join(machine.home, ".ssh/authorized_keys");
  if (existsSync(authorizedKeys) && readFileSync(authorizedKeys, "utf8").includes(publicKey)) return;
  appendFileSync(authorizedKeys, `from="127.0.0.1,::1",no-port-forwarding,no-agent-forwarding,no-X11-forwarding ${publicKey}\n`);
}

function readTccDatabase(machine: Machine, sql: string) {
  const local = run(machine, ["sqlite3", systemTccDatabase, sql]);
  if (local.code === 0) return local.stdout.trim();
  if (!existsSync(probeKey(machine))) return undefined;
  const remote = run(machine, [
    "ssh",
    "-n",
    "-i",
    probeKey(machine),
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile=${probeKnownHosts(machine)}`,
    `${machine.user}@127.0.0.1`,
    `/usr/bin/sqlite3 '${systemTccDatabase}' "${sql}"`,
  ]);
  return remote.code === 0 ? remote.stdout.trim() : undefined;
}

export function grantState(machine: Machine, { kind, path }: Grant): GrantState {
  const client = tccClientOf(machine, path);
  if (!client) return "missing";
  const value = readTccDatabase(machine, grantQuery(grantDetails[kind].service, client));
  if (value === undefined) return "unreadable";
  return value === "2" ? "granted" : "absent";
}

const waitForReturn = (machine: Machine) =>
  run(machine, ["/bin/sh", "-c", 'printf "  Press Return once it is on: " >/dev/tty; read -r _ </dev/tty']);

async function guideGrant(machine: Machine, grant: Grant) {
  const { title, pane } = grantDetails[grant.kind];
  machine.print(`\n  ${title} for ${grant.path}`);
  machine.print(`  System Settings is open at ${title} and Finder shows the item. Drag it into the list (or click + and pick it), then turn it on.`);
  run(machine, [machine.paths.open, pane]);
  run(machine, [machine.paths.open, "-R", grant.path]);
  const deadline = Date.now() + grantWaitSeconds * 1000;
  while (Date.now() < deadline) {
    const state = grantState(machine, grant);
    if (state === "granted") return changed(machine, `${title} for ${grant.path}`);
    if (state === "unreadable") {
      waitForReturn(machine);
      return say(machine, `confirmed by you: ${title} for ${grant.path}`);
    }
    await sleep(2000);
  }
  say(machine, `skipped: ${title} for ${grant.path} was not turned on within ${grantWaitSeconds / 60} minutes`);
}

export const privacyGrants: SetupStep = {
  id: "privacy-grants",
  title: "Privacy grants",
  async apply({ machine, options }) {
    if (options.requestedGrants.length === 0) return;
    ensureTccProbeKey(machine);
    for (const grant of expandGrants(options.requestedGrants)) {
      if (!existsSync(grant.path)) {
        say(machine, `skipped: ${grant.path} does not exist`);
        continue;
      }
      if (grantState(machine, grant) === "granted") unchanged(machine, `${grantDetails[grant.kind].title} for ${grant.path}`);
      else await guideGrant(machine, grant);
    }
  },
  check({ machine, options }, checklist) {
    for (const grant of expandGrants(options.requestedGrants)) {
      const title = `${grantDetails[grant.kind].title} for ${basename(grant.path)}`;
      const state = grantState(machine, grant);
      if (state === "granted") checklist.pass(title);
      else if (state === "unreadable") checklist.note(`${title}: can't be read back until Terminal or remote SSH users have Full Disk Access`);
      else checklist.waitingOnOwner(title, "run provision at the Mac and follow the System Settings steps");
    }
    checklist.note("Privacy grants are switched on by you in System Settings; provision opens each pane and checks it, and never writes the privacy database");
  },
};


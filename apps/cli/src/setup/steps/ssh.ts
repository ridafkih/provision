import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changed, fail, say, unchanged } from "../../core/output";
import { run, sleep, sudo, type Machine } from "../../core/shell";
import type { Setup, SetupStep } from "../context";
import { isListening, localHostName, startSystemDaemon } from "../system";

const sshPlist = "/System/Library/LaunchDaemons/ssh.plist";
const keysOnlyDropIn = "/etc/ssh/sshd_config.d/000-provision-keys-only.conf";
const keysOnlySettings = "PasswordAuthentication no\nKbdInteractiveAuthentication no";

export const keyMaterial = (text: string) =>
  [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim().split(/\s+/))
        .filter((fields) => fields.length >= 2 && /^(ssh-|ecdsa-|sk-)/.test(fields[0]!))
        .map((fields) => `${fields[0]} ${fields[1]}`),
    ),
  ].toSorted();

const readIfPresent = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

export const cachedPublicKeys = (machine: Machine) => join(machine.home, ".provision/authorized-keys");
const authorizedKeysOf = (machine: Machine) => join(machine.home, ".ssh/authorized_keys");

export function wantedPublicKeys({ machine, options }: Setup) {
  const lines: string[] = [];
  for (const user of options.githubUsers) {
    const fetched = run(machine, ["curl", "-fsSL", "--max-time", "15", `https://github.com/${user}.keys`]);
    if (fetched.code !== 0) return undefined;
    lines.push(...fetched.stdout.split("\n").filter(Boolean).map((line) => `${line} github:${user}`));
  }
  lines.push(...options.extraPublicKeys);
  return lines.map((line) => `${line}\n`).join("");
}

export function mergeAuthorizedKeys(authorizedKeys: string, wanted: string) {
  if (!existsSync(authorizedKeys)) writeFileSync(authorizedKeys, "");
  chmodSync(authorizedKeys, 0o600);
  let added = 0;
  for (const line of wanted.split("\n")) {
    const [material] = keyMaterial(line);
    if (!material || keyMaterial(readFileSync(authorizedKeys, "utf8")).includes(material)) continue;
    appendFileSync(authorizedKeys, `${line}\n`);
    added++;
  }
  return added;
}

export function fetchPublicKeys(setup: Setup) {
  const { machine, options } = setup;
  const cache = cachedPublicKeys(machine);
  mkdirSync(join(machine.home, ".provision"), { recursive: true, mode: 0o700 });
  const fetched = wantedPublicKeys(setup);
  if (fetched) {
    writeFileSync(`${cache}.next`, fetched, { mode: 0o600 });
    renameSync(`${cache}.next`, cache);
    say(machine, "fetched the SSH keys to authorize");
  } else if (readIfPresent(cache)) {
    say(machine, "could not fetch the SSH keys; using the ones saved by the last run");
  } else {
    fail(`could not fetch the SSH keys for: ${options.githubUsers.join(" ")}; check the network and run the same command again`);
  }
}

export const ssh: SetupStep = {
  id: "ssh",
  title: "SSH",
  async apply({ machine }) {
    const authorizedKeys = authorizedKeysOf(machine);
    mkdirSync(join(machine.home, ".ssh"), { recursive: true, mode: 0o700 });
    const wanted = readIfPresent(cachedPublicKeys(machine));
    if (!wanted) fail("no SSH public keys to authorize; pass --github <user> or --ssh-key '<key>'");
    const added = mergeAuthorizedKeys(authorizedKeys, wanted);
    if (added === 0) unchanged(machine, `${authorizedKeys} holds every wanted key`);
    else changed(machine, `added ${added} key(s) to ${authorizedKeys}`);

    if (isListening(machine, 22)) unchanged(machine, "Remote Login (SSH) on");
    else {
      startSystemDaemon(machine, "com.openssh.sshd", sshPlist);
      await sleep(1000);
      if (!isListening(machine, 22)) sudo(machine, ["systemsetup", "-f", "-setremotelogin", "on"]);
      if (isListening(machine, 22)) changed(machine, "Remote Login (SSH) on");
      else say(machine, "skipped: Remote Login did not start from the command line");
    }

    if (sudo(machine, ["cat", keysOnlyDropIn]).stdout.trim() === keysOnlySettings) {
      unchanged(machine, "SSH accepts keys only");
      return;
    }
    sudo(machine, ["tee", keysOnlyDropIn], { input: `${keysOnlySettings}\n` });
    sudo(machine, ["chmod", "644", keysOnlyDropIn]);
    if (sudo(machine, ["sshd", "-t"]).code !== 0) fail("sshd rejected its configuration");
    changed(machine, "SSH accepts keys only");
  },
  check({ machine }, checklist) {
    const keyCount = keyMaterial(readIfPresent(authorizedKeysOf(machine))).length;
    if (isListening(machine, 22)) checklist.pass(`SSH on: ssh ${machine.user}@${localHostName(machine)}.local`);
    else checklist.waitingOnOwner("SSH on", "System Settings > General > Sharing > Remote Login");
    if (readIfPresent(keysOnlyDropIn).trim() === keysOnlySettings && keyCount > 0) checklist.pass(`SSH takes keys only (${keyCount} authorized)`);
    else checklist.miss("SSH takes keys only", "rerun provision with --github <user>");
  },
};

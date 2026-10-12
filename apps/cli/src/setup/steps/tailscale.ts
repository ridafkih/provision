import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changed, fail, unchanged } from "../../core/output";
import { output, run, sleep, sudo, type Machine } from "../../core/shell";
import type { Setup, SetupStep } from "../context";
import { requireNameResolution } from "../name-resolution";
import { ensureFormula } from "./homebrew";
import { loadedTailscaleDaemon } from "../tailscale-daemon";

const loginTimeoutSeconds = 1800;
const backendTimeoutSeconds = 60;
const upAttempts = 3;

type TailscaleStatus = {
  BackendState?: string;
  AuthURL?: string;
  Self?: { DNSName?: string; KeyExpiry?: string };
  TailscaleIPs?: string[];
};

export const usesTailscaleDaemon = (machine: Machine) => existsSync(machine.paths.homebrewTailscale) || !existsSync(machine.paths.appTailscale);

const tailscaleCommand = (machine: Machine, argv: string[]) =>
  usesTailscaleDaemon(machine) ? ["sudo", "-n", machine.paths.homebrewTailscale, ...argv] : [machine.paths.appTailscale, ...argv];

const parseStatus = (text: string): TailscaleStatus | undefined => {
  try {
    return JSON.parse(text) as TailscaleStatus;
  } catch {
    return undefined;
  }
};

export function tailscaleStatus(machine: Machine): TailscaleStatus {
  if (!usesTailscaleDaemon(machine)) return parseStatus(output(machine, [machine.paths.appTailscale, "status", "--json"])) ?? {};
  return (
    parseStatus(output(machine, [machine.paths.homebrewTailscale, "status", "--json"])) ??
    parseStatus(sudo(machine, [machine.paths.homebrewTailscale, "status", "--json"]).stdout) ??
    {}
  );
}

export const isOnTailnet = (machine: Machine) => tailscaleStatus(machine).BackendState === "Running";

export const loginUrlIn = (text: string) => text.match(/https:\/\/login\.tailscale\.com\/[A-Za-z0-9/._?=&-]+/)?.[0];

const consoleUser = (machine: Machine) => output(machine, ["stat", "-f", "%Su", "/dev/console"]);

function openForConsoleUser(machine: Machine, url: string) {
  const user = consoleUser(machine);
  if (!user || user === "root") return false;
  const uid = output(machine, ["id", "-u", user]);
  return sudo(machine, ["launchctl", "asuser", uid, "sudo", "-u", user, machine.paths.open, url]).code === 0;
}

export function ensureTailscaleDaemon(machine: Machine) {
  if (!usesTailscaleDaemon(machine)) {
    unchanged(machine, `using the Tailscale app already installed; it connects once ${machine.user} logs in automatically`);
    return;
  }
  ensureFormula(machine, "tailscale");
  if (loadedTailscaleDaemon(machine)) {
    unchanged(machine, "tailscaled runs as a system daemon, before anyone logs in");
    return;
  }
  sudo(machine, [machine.paths.brew, "services", "start", "tailscale"]);
  changed(machine, "tailscaled runs as a system daemon, before anyone logs in");
}

async function waitForTailscaleBackend(machine: Machine) {
  const deadline = Date.now() + backendTimeoutSeconds * 1000;
  while (!tailscaleStatus(machine).BackendState) {
    if (Date.now() > deadline) fail(`tailscaled did not answer within ${backendTimeoutSeconds} seconds; run the same command again`);
    await sleep(1000);
  }
}

export const tailscaleUpArguments = ({ machine, options }: Setup) => [
  "up",
  "--reset",
  "--qr",
  "--timeout=0s",
  ...(usesTailscaleDaemon(machine) ? ["--accept-dns=false"] : []),
  ...(options.wantedHostname ? [`--hostname=${options.wantedHostname}`] : []),
];

const qrLines = (text: string) => text.split("\n").filter((line) => /[█▀▄]/.test(line));

function showLoginUrl(machine: Machine, url: string, loginLog: string) {
  machine.print("\n\x1b[1m  ================================================================");
  machine.print("    Sign in to Tailscale to add this Mac to your tailnet:\n");
  machine.print(`    ${url}`);
  machine.print("  ================================================================\x1b[0m");
  const qr = qrLines(loginLog);
  if (qr.length > 0) machine.print(`\n  Or scan this with your phone:\n\n${qr.join("\n")}`);
  if (openForConsoleUser(machine, url)) machine.print("\n  Opened it in the browser. Waiting until this Mac joins...");
  else machine.print("\n  Open it on any device. Waiting until this Mac joins...");
}

const startTailscaleUp = (machine: Machine, argv: string[], logFile: string) => {
  const command = tailscaleCommand(machine, argv);
  return Bun.spawn(["/bin/sh", "-c", 'log="$1"; shift; exec "$@" >"$log" 2>&1', "sh", logFile, ...command], {
    env: machine.environment,
    stdin: "ignore",
  });
};

export async function signInToTailnet(setup: Setup) {
  const { machine } = setup;
  const argv = tailscaleUpArguments(setup);
  const directory = mkdtempSync(join(tmpdir(), "provision-tailscale-"));
  const logFile = join(directory, "up.log");
  const readLog = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
  let up = startTailscaleUp(machine, argv, logFile);
  let attempt = 1;
  let isShown = false;
  const deadline = Date.now() + loginTimeoutSeconds * 1000;
  try {
    while (!isOnTailnet(machine)) {
      if (Date.now() > deadline) fail(`Tailscale was not signed in within ${loginTimeoutSeconds / 60} minutes; run the same command again`);
      if (!isShown) {
        const url = tailscaleStatus(machine).AuthURL || loginUrlIn(readLog());
        if (url) {
          await sleep(1000);
          showLoginUrl(machine, url, readLog());
          isShown = true;
        } else if (up.exitCode !== null) {
          if (attempt >= upAttempts) {
            process.stderr.write(readLog());
            fail("tailscale up stopped without a sign-in link; run the same command again");
          }
          attempt++;
          await sleep(2000);
          up = startTailscaleUp(machine, argv, logFile);
        }
      }
      await sleep(1000);
    }
  } finally {
    up.kill();
    await up.exited;
    rmSync(directory, { recursive: true, force: true });
  }
  changed(machine, `joined the tailnet as ${tailscaleStatus(machine).Self?.DNSName ?? ""}`);
}

const keepSystemDns = (machine: Machine) => {
  if (usesTailscaleDaemon(machine)) run(machine, tailscaleCommand(machine, ["set", "--accept-dns=false"]));
};

export const tailscaleIp = (machine: Machine) => output(machine, tailscaleCommand(machine, ["ip", "-4"])).split("\n")[0] ?? "";

export const tailscale: SetupStep = {
  id: "tailscale",
  title: "Tailscale",
  async apply(setup) {
    const { machine } = setup;
    ensureTailscaleDaemon(machine);
    await waitForTailscaleBackend(machine);
    if (isOnTailnet(machine)) {
      keepSystemDns(machine);
      unchanged(machine, `on the tailnet as ${tailscaleStatus(machine).Self?.DNSName ?? ""}`);
    } else await signInToTailnet(setup);
    await requireNameResolution(machine, "after joining the tailnet");
  },
  check({ machine }, checklist) {
    const status = tailscaleStatus(machine);
    if (status.BackendState !== "Running") {
      checklist.miss("On the tailnet", "run the same command again and sign in to Tailscale");
      return;
    }
    const name = (status.Self?.DNSName ?? "").replace(/\.$/, "");
    checklist.pass(`On the tailnet as ${name} (${status.TailscaleIPs?.[0] ?? ""}); reconnects on any network`);
    if (!status.Self?.KeyExpiry) checklist.pass("Tailscale key never expires");
    else
      checklist.waitingOnOwner(
        "Tailscale key expiry off, so it never drops off the tailnet",
        "login.tailscale.com/admin/machines > this Mac > ... > Disable key expiry",
      );
  },
};


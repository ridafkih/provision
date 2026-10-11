import packageJson from "../package.json";
import { ProvisionError, fail } from "./core/output";
import { output, run, systemPaths, type Machine } from "./core/shell";
import type { Setup } from "./setup/context";
import { collectCredentials, forgetPassword } from "./setup/credentials";
import { hasForeignFilesInProvisionHome, repairProvisionHome } from "./setup/home";
import { emptyOptions, loadSavedArguments, parseArguments, usage, type Options } from "./setup/options";
import { applySetup, printReport } from "./setup/run";
import { selfCommand, slimProfileFor } from "./setup/steps/slim";
import { runSlimCommand } from "./slim/command";

const createMachine = (): Machine => ({
  home: process.env.HOME ?? fail("HOME is not set"),
  user: process.env.USER ?? fail("USER is not set"),
  environment: {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    PATH: `${process.env.PATH ?? ""}:/usr/bin:/bin:/usr/sbin:/sbin`,
  },
  paths: systemPaths,
  print: (text) => console.log(text),
});

const isCompiled = () => Bun.main.startsWith("/$bunfs/");

function requireMacosAdmin(machine: Machine) {
  if (process.platform !== "darwin") fail("runs on macOS only");
  if (Number(output(machine, ["sw_vers", "-productVersion"]).split(".")[0]) < 15) fail("needs macOS 15 or later");
  if (process.getuid?.() === 0) fail("run it as your own user, not root; it asks for your password once");
  if (!output(machine, ["id", "-Gn"]).split(" ").includes("admin")) fail(`${machine.user} is not an administrator`);
}

const hasPublicKeys = (options: Options) => options.githubUsers.length + options.extraPublicKeys.length > 0;

const optionsFrom = (machine: Machine, argumentList: string[]) => {
  const replaysSaved = argumentList.length === 0 || (argumentList.length === 1 && argumentList[0] === "--check");
  const options = replaysSaved ? parseArguments(loadSavedArguments(machine.home)) : emptyOptions();
  return parseArguments(argumentList, options);
};

const runSelfAsRoot = (machine: Machine, argumentList: string[]) =>
  run(machine, ["sudo", ...selfCommand(), ...argumentList], { isInteractive: true }).code;

async function runTuiCommand(machine: Machine) {
  const options = parseArguments(loadSavedArguments(machine.home));
  const setup: Setup = { machine, options };
  const canApply = hasPublicKeys(options) ? undefined : "Run provision --github <user> once first: setup needs SSH keys to authorize before passwords go off.";
  const { runTui } = await import("./tui/run");
  const request = await runTui(setup, slimProfileFor(setup), canApply);
  if (!request) return;
  if (request.kind === "slim-apply") process.exitCode = runSelfAsRoot(machine, ["slim", "apply", "--only", request.taskIds.join(","), "--yes"]);
  else if (request.kind === "slim-restore") process.exitCode = runSelfAsRoot(machine, ["slim", "restore", "--yes"]);
  else await applySetup(setup, { savedArguments: [], runningBinary: isCompiled() ? process.execPath : undefined, onlySteps: new Set(request.stepIds) });
}

async function main(argumentList: string[]) {
  const [command, ...rest] = argumentList;
  if (command === "slim") return runSlimCommand(rest);
  if (command === "--version") return console.log(packageJson.version);
  if (command === "--help" || command === "-h") return console.log(usage);
  const machine = createMachine();
  requireMacosAdmin(machine);
  if (hasForeignFilesInProvisionHome(machine)) {
    collectCredentials(machine, false);
    repairProvisionHome(machine);
  }
  if (command === "tui") return runTuiCommand(machine);
  const options = optionsFrom(machine, argumentList);
  const setup: Setup = { machine, options };
  if (options.mode === "help") return console.log(usage);
  if (options.mode === "check") {
    await printReport(setup);
    return;
  }
  if (!hasPublicKeys(options)) fail("pass --github <user> or --ssh-key '<key>' so you can still get in once passwords are off");
  await applySetup(setup, { savedArguments: argumentList, runningBinary: isCompiled() ? process.execPath : undefined });
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof ProvisionError)) throw error;
  console.error(`provision: ${error.message}`);
  process.exitCode = 1;
} finally {
  forgetPassword();
}
process.exit(process.exitCode ?? 0);

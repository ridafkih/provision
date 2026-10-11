import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../core/output";
import { profileArguments } from "./profiles";

export const supportedRoles = ["runner", "worker"] as const;
export type Role = (typeof supportedRoles)[number];
export const grantKinds = ["full-disk-access", "screen-recording", "accessibility"] as const;
export type GrantKind = (typeof grantKinds)[number];

export type Options = {
  githubUsers: string[];
  extraPublicKeys: string[];
  roles: Role[];
  runnerLabels: string[];
  requestedGrants: string[];
  runnerPrepullImages: string[];
  runnerRepository: string;
  wantedHostname: string;
  notifyUrl: string;
  isSlimSkipped: boolean;
  isPasswordlessSudoSkipped: boolean;
  mode: "apply" | "check" | "help";
};

export const emptyOptions = (): Options => ({
  githubUsers: [],
  extraPublicKeys: [],
  roles: [],
  runnerLabels: [],
  requestedGrants: [],
  runnerPrepullImages: [],
  runnerRepository: "",
  wantedHostname: "",
  notifyUrl: "",
  isSlimSkipped: false,
  isPasswordlessSudoSkipped: false,
  mode: "apply",
});

export const usage = `provision: set up this Mac to run headless, slim it down, then report whether it is ready to rack.

  provision [options]          set up (with no options, replays the options of the last run)
  provision tui                pick setup steps and slim tasks, preview and apply them
  provision slim <command>     slim this Mac on its own: status, plan, apply, restore, show, measure, protected

  --profile <name>          add the arguments saved in a profile first (rida)
  --github <user>           authorize the SSH keys published at github.com/<user>.keys (repeatable)
  --ssh-key '<public key>'  authorize one more SSH public key (repeatable)
  --hostname <name>         name the Mac and its tailnet device
  --role runner             host ephemeral GitHub Actions runner VMs (needs --runner-repo)
  --role worker             host Tart VMs
  --runner-repo <owner/repo>
  --runner-label <label>    extra runner label beyond self-hosted, Linux, ARM64 (repeatable)
  --runner-prepull <image>  container image to bake into the runner VM (repeatable)
  --grant <kind>:<path>     walk you through a privacy grant in System Settings and check it took;
                            kind is full-disk-access, screen-recording, accessibility or all (repeatable)
  --no-slim                 leave the services and apps macOS ships alone
  --no-passwordless-sudo    keep asking for your password for sudo after setup
  --notify-url <url>        POST a JSON summary here when done
  --check                   only print the checklist
  --version
  --help
`;

const grantPattern = /^(all|full-disk-access|screen-recording|accessibility):\//;

const valueOf = (argumentsLeft: string[], message: string) => {
  const value = argumentsLeft.shift();
  if (value === undefined || value === "") return fail(message);
  return value;
};

export function parseArguments(argumentList: readonly string[], options: Options = emptyOptions()): Options {
  const argumentsLeft = [...argumentList];
  while (argumentsLeft.length > 0) {
    const flag = argumentsLeft.shift()!;
    switch (flag) {
      case "--profile":
        argumentsLeft.unshift(...profileArguments(valueOf(argumentsLeft, "--profile needs a name")));
        break;
      case "--github":
        options.githubUsers.push(valueOf(argumentsLeft, "--github needs a user"));
        break;
      case "--ssh-key":
        options.extraPublicKeys.push(valueOf(argumentsLeft, "--ssh-key needs a key"));
        break;
      case "--hostname":
        options.wantedHostname = valueOf(argumentsLeft, "--hostname needs a name");
        break;
      case "--role": {
        const role = argumentsLeft.shift() ?? "";
        if (!supportedRoles.includes(role as Role)) fail(`unknown role '${role}'; roles: ${supportedRoles.join(" ")}`);
        options.roles.push(role as Role);
        break;
      }
      case "--runner-repo":
        options.runnerRepository = valueOf(argumentsLeft, "--runner-repo needs owner/repo");
        break;
      case "--runner-label":
        options.runnerLabels.push(valueOf(argumentsLeft, "--runner-label needs a label"));
        break;
      case "--runner-prepull":
        options.runnerPrepullImages.push(valueOf(argumentsLeft, "--runner-prepull needs an image"));
        break;
      case "--grant": {
        const grant = argumentsLeft.shift() ?? "";
        if (!grantPattern.test(grant)) fail("--grant takes <all|full-disk-access|screen-recording|accessibility>:<absolute path>");
        options.requestedGrants.push(grant);
        break;
      }
      case "--notify-url":
        options.notifyUrl = valueOf(argumentsLeft, "--notify-url needs a url");
        break;
      case "--no-slim":
        options.isSlimSkipped = true;
        break;
      case "--no-passwordless-sudo":
        options.isPasswordlessSudoSkipped = true;
        break;
      case "--check":
        options.mode = "check";
        break;
      case "--help":
      case "-h":
        options.mode = "help";
        break;
      default:
        fail(`unknown option '${flag}'\n\n${usage}`);
    }
  }
  if (options.wantedHostname && !/^[A-Za-z0-9-]{1,63}$/.test(options.wantedHostname)) fail("--hostname takes letters, digits and dashes");
  return options;
}

export const hasRole = (options: Options, role: Role) => options.roles.includes(role);

export const savedArgumentsFile = (home: string) => join(home, ".provision/arguments");

export const saveArguments = (home: string, argumentList: readonly string[]) =>
  writeFileSync(savedArgumentsFile(home), argumentList.map((argument) => `${argument}\0`).join(""));

export const loadSavedArguments = (home: string): string[] => {
  const file = savedArgumentsFile(home);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\0").slice(0, -1);
};

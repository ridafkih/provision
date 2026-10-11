import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import answerPromptsScript from "../../assets/answer-prompts.exp" with { type: "text" };
import { fail } from "../core/output";
import { run, succeeds, sudo, type Machine } from "../core/shell";

export type Credentials = { password: string; keeper?: Timer };

export const credentials: Credentials = { password: "" };

const hasTerminal = (machine: Machine) => succeeds(machine, ["/bin/sh", "-c", ": </dev/tty"]);

const readHiddenLine = (machine: Machine, prompt: string) =>
  run(machine, ["/bin/bash", "-c", 'printf "%s" "$1" >/dev/tty; IFS= read -r -s line </dev/tty; printf "\\n" >/dev/tty; printf "%s" "$line"', "bash", prompt])
    .stdout;

const tellTerminal = (machine: Machine, text: string) => run(machine, ["/bin/sh", "-c", 'printf "%s\\n" "$1" >/dev/tty', "sh", text]);

export function promptPasswordOnce(machine: Machine) {
  if (credentials.password) return;
  if (!hasTerminal(machine)) fail("needs a terminal to ask for your password; run it in Terminal on the Mac");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const password = readHiddenLine(machine, `Password for ${machine.user} (used for sudo, FileVault and automatic login; never stored or sent): `);
    if (run(machine, ["sudo", "-S", "-p", "", "-v"], { input: `${password}\n` }).code === 0) {
      credentials.password = password;
      return;
    }
    tellTerminal(machine, "That password did not work.");
  }
  fail("three wrong passwords");
}

export const forgetPassword = () => {
  credentials.password = "";
};

export const canSudoWithoutPassword = (machine: Machine) => sudo(machine, ["true"]).code === 0;

export function keepSudoAlive(machine: Machine) {
  if (credentials.keeper) return;
  credentials.keeper = setInterval(() => run(machine, ["sudo", "-n", "-v"]), 30_000);
  credentials.keeper.unref();
}

export function collectCredentials(machine: Machine, needsPassword: boolean) {
  if (credentials.keeper) return;
  if (!canSudoWithoutPassword(machine) || needsPassword) promptPasswordOnce(machine);
  if (!canSudoWithoutPassword(machine)) fail("sudo still asks for a password; run the same command again");
  keepSudoAlive(machine);
}

export function answerPasswordPrompts(machine: Machine, argv: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "provision-"));
  const script = join(directory, "answer-prompts.exp");
  writeFileSync(script, answerPromptsScript);
  chmodSync(script, 0o600);
  try {
    return run(machine, [machine.paths.expect, "-f", script, machine.user, ...argv], {
      environment: { PROVISION_ANSWER: credentials.password },
      isInteractive: true,
    }).code;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

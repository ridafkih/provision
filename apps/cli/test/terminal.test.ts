import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShellSandbox, disposeShellSandbox, type ShellSandbox } from "./shell.ts";

const installScript = resolve(import.meta.dirname, "../../../install.sh");

const archiveWithKit = (sandbox: ShellSandbox, provisionScript: string) => {
  const repository = join(sandbox.root, "provision-main");
  mkdirSync(join(repository, "apps/cli/src"), { recursive: true });
  mkdirSync(join(repository, "apps/cli/profiles"), { recursive: true });
  writeFileSync(join(repository, "apps/cli/src/provision.sh"), provisionScript);
  writeFileSync(join(repository, "apps/cli/profiles/owner.args"), "--github\nowner\n");
  const archive = join(sandbox.root, "main.tar.gz");
  spawnSync("tar", ["-czf", archive, "-C", sandbox.root, "provision-main"], { env: { COPYFILE_DISABLE: "1", PATH: "/usr/bin:/bin" } });
  return `file://${archive}`;
};

const inTerminal = (sandbox: ShellSandbox, command: string, dialogue: string) => {
  const expectScript = join(sandbox.root, "terminal.exp");
  writeFileSync(
    expectScript,
    `set timeout 20
spawn -noecho /bin/bash -c {${command}}
${dialogue}
expect eof
lassign [wait] process_id spawn_id os_error exit_status
exit $exit_status
`,
  );
  return spawnSync("/usr/bin/expect", ["-f", expectScript], {
    encoding: "utf8",
    env: { HOME: sandbox.home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
};

describe("curl | bash in a real terminal", { timeout: 30_000 }, () => {
  let sandbox: ShellSandbox;

  beforeEach(() => {
    sandbox = createShellSandbox();
  });

  afterEach(() => disposeShellSandbox(sandbox));

  it("hands the keyboard to provision even though bash read the installer from a pipe", () => {
    const archive = archiveWithKit(sandbox, 'read -r -p "type something: " reply; echo "heard:$reply args:$*"\n');
    const result = inTerminal(
      sandbox,
      `cat "${installScript}" | bash -s -- --archive ${archive} --profile owner`,
      'expect "type something: "\nsend "hello\\r"\nexpect "heard:hello args:--github owner"',
    );
    expect({ status: result.status, stdout: result.stdout }).toMatchObject({ status: 0 });
  });

  it("asks for the password up front, in the terminal, before any step runs", () => {
    const provisionScript = resolve(import.meta.dirname, "../src/provision.sh");
    const fakeSudo = join(sandbox.bin, "sudo");
    writeFileSync(fakeSudo, '#!/bin/bash\nif [ "$1" = -S ]; then read -r password; [ "$password" = secret ]; exit; fi\nexit 1\n', { mode: 0o755 });
    const result = inTerminal(
      sandbox,
      `PATH="${sandbox.bin}:$PATH" USER=rack bash -c 'source "${provisionScript}"; needs_unattended_boot_password() { return 1; }; collect_credentials' < /dev/null`,
      'expect "Password for rack"\nsend "wrong\\r"\nexpect "did not work"\nexpect "Password for rack"\nsend "secret\\r"\nexpect "sudo still asks"',
    );
    expect(result.stdout).toContain("That password did not work.");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { addFakeCommand, createSandbox, disposeSandbox, publishFakeBinary, type Sandbox } from "../sandbox";

const installScript = resolve(import.meta.dirname, "../../../../install.sh");
const credentialsFixture = resolve(import.meta.dirname, "../fixtures/collect-credentials.ts");

const inTerminal = (sandbox: Sandbox, command: string, dialogue: string) => {
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
  return spawnSync("/usr/bin/expect", ["-f", expectScript], { encoding: "utf8", env: { HOME: sandbox.home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } });
};

describe("curl | bash in a real terminal", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
  });
  afterEach(() => disposeSandbox(sandbox));

  it("hands the keyboard to provision even though bash read the installer from a pipe", () => {
    const binary = publishFakeBinary(sandbox, 'read -r -p "type something: " reply; echo "heard:$reply args:$*"\n');
    const result = inTerminal(
      sandbox,
      `cat "${installScript}" | bash -s -- --binary ${binary} --profile owner`,
      'expect "type something: "\nsend "hello\\r"\nexpect "heard:hello args:--profile owner"',
    );
    expect(result.status).toBe(0);
  }, 30_000);

  it("asks for the password up front, in the terminal, and asks again after a wrong one", () => {
    addFakeCommand(sandbox, "sudo", 'if [ "$1" = -S ]; then read -r password; [ "$password" = secret ] && touch "$HOME/unlocked"; [ "$password" = secret ]; exit; fi\n[ -e "$HOME/unlocked" ]');
    const result = inTerminal(
      sandbox,
      `${process.execPath} ${credentialsFixture} ${sandbox.bin} ${sandbox.home} < /dev/null`,
      'expect "Password for rack"\nsend "wrong\\r"\nexpect "did not work"\nexpect "Password for rack"\nsend "secret\\r"\nexpect "collected"',
    );
    expect(result.stdout).toContain("That password did not work.");
    expect(result.status).toBe(0);
  }, 30_000);
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loginUrlIn, signInToTailnet } from "../../src/setup/steps/tailscale";
import { addFakeCommand, addFakeSudo, createSandbox, disposeSandbox, printedText, setupOf, type Sandbox } from "../sandbox";

const loginUrl = "https://login.tailscale.com/a/1a2b3c4d5e";

const addFakeTailscale = (sandbox: Sandbox, firstUpFails = false) => {
  const fake = join(sandbox.bin, "tailscale-daemon");
  writeFileSync(
    fake,
    `#!/bin/bash
state="$HOME/tailscale"
mkdir -p "$state"
printf '%s\\n' "$*" >> "$state/calls"
case "$1" in
  status)
    if [ -e "$state/joined" ]; then
      echo '{"BackendState":"Running","Self":{"DNSName":"rack-1.tailnet.ts.net."}}'
    elif [ -e "$state/up-running" ]; then
      echo '{"BackendState":"NeedsLogin","AuthURL":"${loginUrl}"}'
    else
      echo '{"BackendState":"NeedsLogin"}'
    fi
    ;;
  up)
    if ${firstUpFails ? "true" : "false"} && [ ! -e "$state/failed-once" ]; then
      touch "$state/failed-once"
      echo "failed to connect to local tailscaled" >&2
      exit 1
    fi
    touch "$state/up-running"
    printf 'To authenticate, visit:\\n\\n\\t${loginUrl}\\n\\n\\342\\226\\210\\342\\226\\200\\342\\226\\200 qr line\\n'
    while [ ! -e "$state/joined" ]; do sleep 0.2; done
    ;;
  set|down) ;;
esac
`,
    { mode: 0o755 },
  );
  sandbox.machine.paths.homebrewTailscale = fake;
};

const addConsoleUser = (sandbox: Sandbox) => {
  addFakeCommand(sandbox, "stat", "echo rack");
  addFakeCommand(sandbox, "id", "echo 501");
  addFakeCommand(sandbox, "launchctl", '[ "$1" = asuser ] && { shift 2; exec "$@"; }; exit 0');
  sandbox.machine.paths.open = addFakeCommand(sandbox, "browser-open", 'printf "%s\\n" "$1" > "$HOME/opened"; touch "$HOME/tailscale/joined"');
};

describe("Tailscale sign-in", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    addFakeSudo(sandbox);
  });
  afterEach(() => disposeSandbox(sandbox));

  it("finds the login URL in tailscale up's output", () => {
    expect(loginUrlIn(`\nTo authenticate, visit:\n\n\t${loginUrl}\n\n`)).toBe(loginUrl);
  });

  it("opens the sign-in page in the console user's browser session, prints it big with a QR code, and waits until it joins", async () => {
    addFakeTailscale(sandbox);
    addConsoleUser(sandbox);
    await signInToTailnet(setupOf(sandbox, ["--hostname", "rack-1"]));
    expect(readFileSync(join(sandbox.home, "opened"), "utf8").trim()).toBe(loginUrl);
    expect(readFileSync(join(sandbox.home, "sudo.log"), "utf8")).toContain(`-n launchctl asuser 501 sudo -u rack ${sandbox.machine.paths.open} ${loginUrl}`);
    const printed = printedText(sandbox);
    expect(printed).toContain(`    ${loginUrl}\n`);
    expect(printed).toContain("Or scan this with your phone");
    expect(printed).toContain("qr line");
    expect(printed).toContain("joined the tailnet as rack-1.tailnet.ts.net.");
    expect(readFileSync(join(sandbox.home, "tailscale/calls"), "utf8")).toContain("up --reset --qr --timeout=0s --accept-dns=false --hostname=rack-1");
  }, 30_000);

  it("starts tailscale up again when the daemon was not ready the first time", async () => {
    addFakeTailscale(sandbox, true);
    addConsoleUser(sandbox);
    await signInToTailnet(setupOf(sandbox));
    expect(readFileSync(join(sandbox.home, "tailscale/calls"), "utf8").match(/^up /gm)).toHaveLength(2);
  }, 30_000);

  it("still prints the link when no one is logged in at the screen", async () => {
    addFakeTailscale(sandbox);
    addFakeCommand(sandbox, "stat", "echo root");
    setTimeout(() => writeFileSync(join(sandbox.home, "tailscale/joined"), ""), 3000);
    await signInToTailnet(setupOf(sandbox));
    expect(printedText(sandbox)).toContain("Open it on any device");
    expect(printedText(sandbox)).toContain(loginUrl);
  }, 30_000);
});

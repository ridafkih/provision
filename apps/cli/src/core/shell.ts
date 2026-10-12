export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export async function sh(argv: string[]): Promise<Result> {
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

export async function out(argv: string[]): Promise<string> {
  return (await sh(argv)).stdout.trim();
}

/** Quote an argv for display so dry-run output can be pasted into a shell. */
export function quote(argv: string[]): string {
  return argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`)).join(" ");
}

export type Machine = {
  home: string;
  user: string;
  environment: Record<string, string>;
  paths: Paths;
  print: (text: string) => void;
};

export type Paths = {
  brew: string;
  homebrewTailscale: string;
  appTailscale: string;
  open: string;
  expect: string;
  socketFilter: string;
  remoteManagementKickstart: string;
  commandLink: string;
  sudoersDirectory: string;
  pfAnchorsDirectory: string;
  launchDaemonsDirectory: string;
};

export const systemPaths: Paths = {
  brew: "/opt/homebrew/bin/brew",
  homebrewTailscale: "/opt/homebrew/bin/tailscale",
  appTailscale: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  open: "/usr/bin/open",
  expect: "/usr/bin/expect",
  socketFilter: "/usr/libexec/ApplicationFirewall/socketfilterfw",
  remoteManagementKickstart: "/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart",
  commandLink: "/usr/local/bin/provision",
  sudoersDirectory: "/etc/sudoers.d",
  pfAnchorsDirectory: "/etc/pf.anchors",
  launchDaemonsDirectory: "/Library/LaunchDaemons",
};

export type RunOptions = { input?: string; isInteractive?: boolean; environment?: Record<string, string> };

const resolveCommand = (machine: Machine, command: string) =>
  command.includes("/") ? command : (Bun.which(command, { PATH: machine.environment.PATH }) ?? command);

export function run(machine: Machine, argv: string[], options: RunOptions = {}): Result {
  const [command, ...rest] = argv;
  try {
    const result = Bun.spawnSync([resolveCommand(machine, command!), ...rest], {
      env: { ...machine.environment, ...options.environment },
      cwd: machine.home,
      stdin: options.input === undefined ? (options.isInteractive ? "inherit" : "ignore") : Buffer.from(options.input),
      stdout: options.isInteractive ? "inherit" : "pipe",
      stderr: options.isInteractive ? "inherit" : "pipe",
    });
    return { code: result.exitCode ?? 1, stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" };
  } catch (error) {
    return { code: 127, stdout: "", stderr: (error as Error).message };
  }
}

export const succeeds = (machine: Machine, argv: string[], options?: RunOptions) => run(machine, argv, options).code === 0;

export const output = (machine: Machine, argv: string[], options?: RunOptions) => run(machine, argv, options).stdout.trim();

export const sudo = (machine: Machine, argv: string[], options?: RunOptions) => run(machine, ["sudo", "-n", ...argv], options);

export const sleep = (milliseconds: number) => Bun.sleep(milliseconds);

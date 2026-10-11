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

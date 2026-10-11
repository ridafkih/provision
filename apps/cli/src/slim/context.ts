import { out } from "../core/shell";

export interface Context {
  isRoot: boolean;
  /** The human user whose GUI session (gui/<uid>) and preferences we act on. */
  uid: number;
  user: string;
  /** true when System Integrity Protection is enabled. */
  sip: boolean;
  model: string;
  os: string;
  build: string;
}

export async function detect(): Promise<Context> {
  const isRoot = process.getuid?.() === 0;
  let uid = process.getuid?.() ?? 501;
  let user = process.env.USER ?? "";

  if (isRoot) {
    if (process.env.SUDO_UID && process.env.SUDO_USER) {
      uid = Number(process.env.SUDO_UID);
      user = process.env.SUDO_USER;
    } else {
      // Launched by launchd or a root shell: fall back to whoever owns the console.
      user = await out(["stat", "-f", "%Su", "/dev/console"]);
      uid = Number(await out(["id", "-u", user]));
    }
  }

  const [sip, model, os, build] = await Promise.all([
    out(["csrutil", "status"]),
    out(["sysctl", "-n", "hw.model"]),
    out(["sw_vers", "-productVersion"]),
    out(["sw_vers", "-buildVersion"]),
  ]);

  return {
    isRoot,
    uid,
    user,
    sip: !/disabled/i.test(sip),
    model,
    os,
    build,
  };
}

import type { LaunchdState } from "./launchd";
import { out } from "./sh";

export interface Metrics {
  at: string;
  processes: number;
  /** Sum of resident set sizes. Overcounts shared pages, but tracks change well. */
  rssMB: number;
  /** launchd jobs with a live process in the system and user GUI domains. */
  runningJobs: number;
  diskFreeGB: number;
  diskUsedGB: number;
}

const running = (m: Map<string, number>) => [...m.values()].filter((pid) => pid > 0).length;

export async function measure(launchd: LaunchdState): Promise<Metrics> {
  const [ps, df] = await Promise.all([out(["ps", "-axo", "rss="]), out(["df", "-k", "/System/Volumes/Data"])]);
  const rss = ps.split("\n").map(Number).filter(Number.isFinite);
  const cols = df.split("\n")[1]?.trim().split(/\s+/) ?? [];
  return {
    at: new Date().toISOString(),
    processes: rss.length,
    rssMB: Math.round(rss.reduce((a, b) => a + b, 0) / 1024),
    runningJobs: running(launchd.system.loaded) + running(launchd.gui.loaded),
    diskUsedGB: Math.round((Number(cols[2]) / 1024 / 1024) * 10) / 10,
    diskFreeGB: Math.round((Number(cols[3]) / 1024 / 1024) * 10) / 10,
  };
}

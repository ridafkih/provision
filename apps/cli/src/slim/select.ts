import { TIERS, inProfile, type Task, type Tier } from "./task";

export interface Selection {
  profile: Tier;
  only?: string[];
  except?: string[];
}

const matches = (t: Task, names: string[]) => names.includes(t.id) || names.includes(t.group);

/** Resolve a profile plus --only/--except (task ids or group names) into tasks. */
export function select(tasks: Task[], { profile, only, except }: Selection): Task[] {
  const known = new Set(tasks.flatMap((t) => [t.id, t.group]));
  for (const name of [...(only ?? []), ...(except ?? [])]) {
    if (!known.has(name)) throw new Error(`unknown task or group: ${name}`);
  }
  return tasks.filter(
    (t) => (only?.length ? matches(t, only) : inProfile(t, profile)) && !(except?.length && matches(t, except)),
  );
}

export function parseTier(value: string | undefined): Tier {
  const tier = (value ?? "host") as Tier;
  if (!TIERS.includes(tier)) throw new Error(`unknown profile: ${value} (expected ${TIERS.join(", ")})`);
  return tier;
}

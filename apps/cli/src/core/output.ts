import type { Machine } from "./shell";

export class ProvisionError extends Error {}

export const fail = (message: string): never => {
  throw new ProvisionError(message);
};

export const heading = (machine: Machine, title: string) => machine.print(`\n\x1b[1m== ${title}\x1b[0m`);

export const say = (machine: Machine, text: string) => machine.print(text);

export const changed = (machine: Machine, text: string) => machine.print(`set: ${text}`);

export const unchanged = (machine: Machine, text: string) => machine.print(`unchanged: ${text}`);

export const report = (machine: Machine, isChanged: boolean, text: string) => (isChanged ? changed : unchanged)(machine, text);

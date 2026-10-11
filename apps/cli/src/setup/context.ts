import type { Checklist } from "../core/checklist";
import type { Machine } from "../core/shell";
import type { Options } from "./options";

export type Setup = { machine: Machine; options: Options };

export type SetupStep = {
  id: string;
  title: string;
  apply: (setup: Setup) => void | Promise<void>;
  check?: (setup: Setup, checklist: Checklist) => void | Promise<void>;
};

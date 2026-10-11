import rida from "../../assets/profiles/rida.args" with { type: "text" };
import { fail } from "../core/output";

const profiles: Record<string, string> = { rida };

export const parseProfile = (text: string) => text.split("\n").filter((line) => line.length > 0);

export const profileArguments = (name: string) => {
  const text = profiles[name];
  if (text === undefined) return fail(`no profile named ${name}`);
  return parseProfile(text);
};

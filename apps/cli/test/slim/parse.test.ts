import { expect, test } from "bun:test";
import { parsePmset } from "../../src/slim/catalog/kinds";
import { argvFor } from "../../src/slim/engine";
import { parseOverrides, parseServices } from "../../src/slim/launchd";
import { quote } from "../../src/core/shell";
import type { Context } from "../../src/slim/context";

test("parseOverrides reads both launchctl spellings", () => {
  const text = `\tdisabled services = {\n\t\t"com.apple.ftpd" => disabled\n\t\t"com.apple.screensharing" => enabled\n\t\t"com.apple.old" => true\n\t}`;
  expect([...parseOverrides(text)]).toEqual([
    ["com.apple.ftpd", true],
    ["com.apple.screensharing", false],
    ["com.apple.old", true],
  ]);
});

test("parseServices reads pid and label from the services block only", () => {
  const text = [
    "system = {",
    "\tservices = {",
    "\t\t     575      - \tcom.apple.kernelmanager_helper",
    "\t\t       0      - \tcom.apple.lskdd",
    "\t\t       -     78 \tcom.apple.crashed",
    "\t}",
    "",
    "\tendpoints = {",
    "\t\t       0      - \tnot.a.service",
    "\t}",
  ].join("\n");
  expect([...parseServices(text)]).toEqual([
    ["com.apple.kernelmanager_helper", 575],
    ["com.apple.lskdd", 0],
    ["com.apple.crashed", 0],
  ]);
});

test("parsePmset takes the leading number", () => {
  const map = parsePmset(" standby              0\n sleep                1 (sleep prevented by powerd)\n powernap             1\n");
  expect(Object.fromEntries(map)).toEqual({ standby: 0, sleep: 1, powernap: 1 });
});

test("quote leaves simple args bare and quotes the rest", () => {
  expect(quote(["defaults", "write", "com.apple.assistant.support", "Assistant Enabled", "-bool", "false"])).toBe(
    "defaults write com.apple.assistant.support 'Assistant Enabled' -bool false",
  );
});

test("user steps run in the user's session only when we're root", () => {
  const ctx = { isRoot: true, uid: 501, user: "me" } as Context;
  expect(argvFor({ argv: ["defaults", "read"], asUser: true }, ctx)).toEqual(["launchctl", "asuser", "501", "sudo", "-u", "me", "defaults", "read"]);
  expect(argvFor({ argv: ["defaults", "read"], asUser: true }, { ...ctx, isRoot: false })).toEqual(["defaults", "read"]);
  expect(argvFor({ argv: ["pmset"] }, ctx)).toEqual(["pmset"]);
});

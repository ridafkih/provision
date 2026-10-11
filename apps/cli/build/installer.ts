const payloadDelimiter = "PROVISION_PAYLOAD";

export const shellQuote = (word: string) => `'${word.replaceAll("'", `'"'"'`)}'`;

export const parseProfile = (text: string) => text.split("\n").filter((line) => line.length > 0);

const wrapLines = (text: string, width: number) => text.match(new RegExp(`.{1,${width}}`, "g")) ?? [];

export const renderInstaller = ({ payloadBase64, profileArguments }: { payloadBase64: string; profileArguments: readonly string[] }) => {
  if (payloadBase64.includes(payloadDelimiter)) throw new Error("payload collides with its heredoc delimiter");
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    `[[ "$(uname -s)" == Darwin ]] || { printf 'provision runs on macOS only\\n' >&2; exit 1; }`,
    'provision_home="$HOME/.provision"',
    'staging="$(mktemp -d)"',
    `/usr/bin/base64 -D <<'${payloadDelimiter}' | /usr/bin/tar -xzf - -C "$staging"`,
    ...wrapLines(payloadBase64, 76),
    payloadDelimiter,
    'mkdir -p -m 700 "$provision_home"',
    'rm -rf "$provision_home/kit"',
    'mv "$staging" "$provision_home/kit"',
    `profile_arguments=(${profileArguments.map(shellQuote).join(" ")})`,
    'exec /bin/bash "$provision_home/kit/provision.sh" ${profile_arguments[@]+"${profile_arguments[@]}"} "$@"',
    "",
  ].join("\n");
};

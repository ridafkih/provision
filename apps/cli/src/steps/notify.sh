notify_payload() {
  /usr/bin/jq --null-input --compact-output \
    --arg hostname "$(scutil --get LocalHostName)" \
    --arg user "$USER" \
    --arg tailnet_name "$(tailscale_field '.Self.DNSName' | sed 's/\.$//')" \
    --arg tailnet_ip "$(sudo "$(tailscale_cli)" ip -4 2>/dev/null | head -n 1)" \
    --arg roles "${roles[*]-}" \
    --argjson failures "$checklist_failures" \
    --argjson waiting "$checklist_waiting" \
    '{event: "provisioned", hostname: $hostname, user: $user, tailnet_name: $tailnet_name, tailnet_ip: $tailnet_ip, roles: ($roles | split(" ") | map(select(. != ""))), failures: $failures, waiting_on_owner: $waiting}'
}

send_notification() {
  [[ -n "$notify_url" ]] || return 0
  if notify_payload | curl -fsS --max-time 15 -H 'content-type: application/json' --data @- "$notify_url" >/dev/null; then
    say "notified $notify_url"
  else
    say "could not notify $notify_url"
  fi
}

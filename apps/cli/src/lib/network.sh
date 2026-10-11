readonly name_resolution_probe="github.com"

can_resolve_names() {
  dscacheutil -q host -a name "$name_resolution_probe" 2>/dev/null | grep -q '^ip_address:'
}

flush_name_cache() {
  sudo dscacheutil -flushcache 2>/dev/null || true
  sudo killall -HUP mDNSResponder 2>/dev/null || true
  sleep 1
}

repair_name_resolution() {
  can_resolve_names && return 0
  flush_name_cache
  can_resolve_names && { changed "flushed a stale DNS cache"; return 0; }
  [[ -x "$homebrew_tailscale" ]] || return 1
  sudo "$homebrew_tailscale" set --accept-dns=false >/dev/null 2>&1 || true
  flush_name_cache
  can_resolve_names && { changed "stopped Tailscale from taking over DNS"; return 0; }
  sudo "$homebrew_tailscale" down >/dev/null 2>&1 || true
  flush_name_cache
  can_resolve_names && { changed "took Tailscale down until sign-in, so DNS works again"; return 0; }
  sudo launchctl bootout system/homebrew.mxcl.tailscale >/dev/null 2>&1 || true
  flush_name_cache
  can_resolve_names && { changed "stopped tailscaled until sign-in, so DNS works again"; return 0; }
  return 1
}

require_name_resolution() {
  repair_name_resolution && return 0
  die "this Mac can't look up $name_resolution_probe $1. Check the network cable or Wi-Fi, then run the same command again."
}

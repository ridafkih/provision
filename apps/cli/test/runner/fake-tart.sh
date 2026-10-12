#!/bin/bash
set -eu
state="$FAKE_TART_STATE"
printf '%s\n' "$*" >> "$state/calls.log"
command="$1"
shift
case "$command" in
  get) [ -e "$state/vms/$1" ] ;;
  clone) touch "$state/vms/$2" ;;
  rename) mv "$state/vms/$1" "$state/vms/$2" ;;
  delete) rm -f "$state/vms/$1" ;;
  run)
    vm_name="${!#}"
    rm -f "$state/stopped-$vm_name"
    while [ -e "$state/vms/$vm_name" ] && [ ! -e "$state/stopped-$vm_name" ] && [ ! -e "$state/crashed-$vm_name" ]; do sleep 0.1; done
    ;;
  stop) touch "$state/stopped-$1" ;;
  exec)
    if [ "$1" = "-i" ]; then
      cat > "$state/exec-stdin"
      exec sleep "$FAKE_JOB_SECONDS"
    fi
    if [ -e "$state/wedged-$1" ]; then exec sleep 3600; fi
    ;;
  set|pull|prune) ;;
  *) exit 64 ;;
esac

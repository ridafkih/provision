checklist_lines=()
checklist_failures=0
checklist_waiting=0

pass() {
  checklist_lines+=("ok|$1")
}

miss() {
  checklist_lines+=("fail|$1|$2")
  checklist_failures=$((checklist_failures + 1))
}

waiting_on_owner() {
  checklist_lines+=("owner|$1|$2")
  checklist_waiting=$((checklist_waiting + 1))
}

note() {
  checklist_lines+=("note|$1")
}

render_checklist() {
  local line kind label hint
  for line in ${checklist_lines[@]+"${checklist_lines[@]}"}; do
    kind="${line%%|*}"
    line="${line#*|}"
    label="${line%%|*}"
    hint=""
    [[ "$line" == *"|"* ]] && hint="${line#*|}"
    case "$kind" in
      ok) printf '  \342\234\223 %s\n' "$label" ;;
      fail) printf '  \342\234\227 %s\n      fix: %s\n' "$label" "$hint" ;;
      owner) printf '  ! %s\n      you: %s\n' "$label" "$hint" ;;
      note) printf '  \302\267 %s\n' "$label" ;;
    esac
  done
}

checklist_verdict() {
  if ((checklist_failures > 0)); then
    printf 'Not ready to rack: %s item(s) failed. Fix them and run provision again.\n' "$checklist_failures"
  elif ((checklist_waiting > 0)); then
    printf 'Ready to rack once you do the %s item(s) marked !.\n' "$checklist_waiting"
  else
    printf 'Ready to rack.\n'
  fi
}

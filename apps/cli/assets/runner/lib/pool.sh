select_pool() {
  pool_name="$1"
  case "$pool_name" in
    linux)
      pool_base_image="$LINUX_BASE_IMAGE"
      pool_golden_vm="$LINUX_GOLDEN_VM"
      pool_labels="$RUNNER_LABELS"
      pool_memory_mb="$VM_MEMORY_MB"
      pool_bake_memory_mb="$BAKE_MEMORY_MB"
      pool_disk_gb="$VM_DISK_GB"
      pool_prepare_script="prepare-linux-vm.sh"
      pool_state_file="$runner_config_directory/golden.env"
      pool_runner_platform="linux"
      pool_name_tag=""
      ;;
    macos)
      ((MACOS_SLOTS > 0)) || fail "this host has no macOS runner slot; MACOS_SLOTS is 0"
      pool_base_image="$MACOS_BASE_IMAGE"
      pool_golden_vm="$MACOS_GOLDEN_VM"
      pool_labels="$MACOS_RUNNER_LABELS"
      pool_memory_mb="$MACOS_VM_MEMORY_MB"
      pool_bake_memory_mb="$MACOS_VM_MEMORY_MB"
      pool_disk_gb=""
      pool_prepare_script="prepare-macos-vm.sh"
      pool_state_file="$runner_config_directory/golden-macos.env"
      pool_runner_platform="osx"
      pool_name_tag="macos-"
      ;;
    *) fail "unknown runner pool '$pool_name'; pools: linux macos" ;;
  esac
}

configured_pools() {
  printf 'linux\n'
  ((MACOS_SLOTS == 0)) || printf 'macos\n'
}

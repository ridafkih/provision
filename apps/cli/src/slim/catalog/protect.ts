/**
 * Labels macslim must never disable, with the reason. The catalog is checked
 * against this at startup and in tests; a task that names one of these won't load.
 */
export const PROTECTED: Record<string, string> = {
  // GUI login: with WindowManager.agent disabled the login session never comes up and auto-login
  // falls back to the password prompt (found by bisecting on 2026-10-11).
  "com.apple.WindowManager.agent": "GUI login session (auto-login needs it)",
  // Disabling this together with Control Center bounced login on 2026-10-11. Control Center
  // alone is fine (task control-center, verified across a reboot the same day).
  "com.apple.MenuBarAgent": "GUI login session (disabling it with Control Center bounced login on 2026-10-11)",
  "com.apple.controlcenter": "GUI login session (part of the menu bar that auto-login waits for)",

  "com.apple.bluetoothd": "coreaudiod's Bluetooth plugin leaks memory in a retry loop without it",

  // Host role: VMs, remote access, updates (explicit requirements)
  "com.apple.NetworkSharing": "vmnet NAT for VMs",
  "com.apple.bootpd": "DHCP for VMs on vmnet NAT",
  "com.apple.sysextd": "system extensions (Tailscale, network filters)",
  "com.apple.softwareupdated": "macOS updates",
  "com.apple.mobile.softwareupdated": "macOS updates",
  "com.apple.mobileassetd": "update, Xcode platform and simulator runtime downloads",

  // Networking & DNS
  "com.apple.mDNSResponder.reloaded": "DNS and Bonjour",
  "com.apple.mDNSResponderHelper.reloaded": "DNS and Bonjour",
  "com.apple.configd": "network configuration",
  "com.apple.airportd": "Wi-Fi",
  "com.apple.wifi.WiFiAgent": "Wi-Fi",
  "com.apple.wifiFirmwareLoader": "Wi-Fi",
  "com.apple.symptomsd": "network path monitoring",
  "com.apple.nehelper": "Network Extensions (VPN, Tailscale)",
  "com.apple.neagent": "Network Extensions (VPN, Tailscale)",
  "com.apple.nesessionmanager": "Network Extensions (VPN, Tailscale)",
  "com.apple.networkserviceproxy": "networking",
  "com.apple.nsurlsessiond": "URL downloads",
  "com.apple.nsurlsessiond_privileged": "URL downloads",
  "com.apple.dhcp6d": "IPv6",
  "com.apple.pfd": "packet filter",
  "com.apple.pfctl": "packet filter",
  "com.apple.apsd": "push notifications, MDM",

  // Security, identity, signing
  "com.apple.securityd": "keychain",
  "com.apple.securityd.system": "keychain",
  "com.apple.trustd": "certificate trust / TLS",
  "com.apple.trustd.agent": "certificate trust / TLS",
  "com.apple.trustdFileHelper": "certificate trust / TLS",
  "com.apple.ocspd": "certificate revocation",
  "com.apple.opendirectoryd": "users, login, sudo",
  "com.apple.security.syspolicy": "Gatekeeper / code signing",
  "com.apple.taskgated": "code signing",
  "com.apple.taskgated-helper": "code signing",
  "com.apple.endpointsecurity.endpointsecurityd": "Endpoint Security",
  "com.apple.akd": "Apple ID auth (Xcode signing)",
  "com.apple.identityservicesd": "Apple ID services",

  // Session & core OS
  "com.apple.WindowServer": "GUI session (simulators, UI tests, Screen Sharing)",
  "com.apple.loginwindow": "login",
  "com.apple.SystemUIServer.agent": "menu bar host",
  "com.apple.UserNotificationCenterAgent": "system alerts and authorization prompts",
  "com.apple.coreservices.uiagent": "Gatekeeper and launch prompts",
  "com.apple.iconservices.iconservicesagent": "app icons (used by every GUI app)",
  "com.apple.AccessibilityUIServer": "accessibility (XCUITest)",
  "com.apple.universalaccessd": "accessibility (XCUITest)",
  "com.apple.diagnosticd": "logging",
  "com.apple.logd": "logging",
  "com.apple.powerd": "power management",
  "com.apple.coreservicesd": "Launch Services",
  "com.apple.runningboardd": "process lifecycle",
  "com.apple.cfprefsd.xpc.daemon": "preferences",
  "com.apple.cfprefsd.xpc.agent": "preferences",
  "com.apple.ReportCrash": "crash logs for failed tests",
  "com.apple.ReportCrash.Root": "crash logs for failed tests",

  // Developer tooling
  "com.apple.testmanagerd": "XCTest",
  "com.apple.testmanagerd.remote": "XCTest",
  "com.apple.remoted": "device connections",
  "com.apple.aned": "Neural Engine (Core ML builds)",
  "com.apple.aneuserd": "Neural Engine (Core ML builds)",
};

/** Whole families that stay untouched. */
export const PROTECTED_PREFIXES: Record<string, string> = {
  "com.apple.Virtualization.": "Virtualization.framework",
  "com.apple.screensharing": "Screen Sharing",
  "com.apple.RemoteDesktop.": "Screen Sharing / Remote Management",
  "com.openssh.": "SSH",
  "com.apple.dt.": "Xcode tooling",
  "com.apple.CoreSimulator.": "iOS Simulator",
};

/** Returns why a label is protected, or null if macslim may disable it. */
export function protection(label: string): string | null {
  if (PROTECTED[label]) return PROTECTED[label];
  for (const [prefix, why] of Object.entries(PROTECTED_PREFIXES)) {
    if (label.startsWith(prefix)) return why;
  }
  // Anything that isn't Apple's (Tailscale's sh.brew.tailscale, runners, …) is never ours to touch.
  if (!label.startsWith("com.apple.")) return "third-party service";
  return null;
}

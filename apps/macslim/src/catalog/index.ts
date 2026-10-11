import { out } from "../core/sh";
import { summarize, type Item, type Step, type Task } from "../core/task";
import { power, prefs, remove, services } from "./kinds";
import { keepTerminal } from "./keep-terminal";
import { protection } from "./protect";

/** Volumes Spotlight indexes on a stock install. */
const SPOTLIGHT_VOLUMES = ["/", "/System/Volumes/Data"];

const spotlightIndex: Task = {
  id: "spotlight-index",
  group: "spotlight",
  title: "Spotlight indexing",
  summary: "Stop indexing every volume and erase the index (mds_stores was the top CPU user at first boot).",
  tier: "host",
  caveat: "Finder search, ⌘-Space and mdfind return nothing; Xcode can't auto-locate dSYMs (pass paths to atos instead).",
  async inspect() {
    const items: Item[] = [];
    for (const volume of SPOTLIGHT_VOLUMES) {
      const status = await out(["mdutil", "-s", volume]);
      items.push({ name: volume, state: /Indexing disabled/i.test(status) ? "done" : "todo" });
    }
    const todo = items.some((i) => i.state === "todo");
    const apply: Step[] = todo
      ? [{ argv: ["mdutil", "-a", "-i", "off"] }, { argv: ["mdutil", "-a", "-E"], tolerate: true }]
      : [];
    const undo: Step[] = todo ? [{ argv: ["mdutil", "-a", "-i", "on"] }] : [];
    return { state: summarize(items), items, apply, undo };
  },
};

const remoteLogin: Task = {
  id: "remote-login",
  group: "host",
  title: "Keep SSH enabled",
  summary: "Make sure Remote Login (sshd) is enabled and loaded, so the host stays reachable headless.",
  tier: "lean",
  async inspect({ launchd }) {
    const label = "com.openssh.sshd";
    const path = await launchd.plist(label, "system");
    const disabled = launchd.system.overrides.get(label) !== false;
    const loaded = launchd.system.loaded.has(label);
    const ok = !disabled && loaded;
    const items: Item[] = [{ name: label, state: ok ? "done" : "todo", note: ok ? undefined : "Remote Login is off" }];
    if (ok || !path) return { state: summarize(items), items, apply: [], undo: [] };
    return {
      state: "todo",
      items,
      apply: [
        { argv: ["launchctl", "enable", `system/${label}`] },
        { argv: ["launchctl", "bootstrap", "system", path], tolerate: true },
      ],
      undo: disabled
        ? [
            { argv: ["launchctl", "bootout", `system/${label}`], tolerate: true },
            { argv: ["launchctl", "disable", `system/${label}`] },
          ]
        : [{ argv: ["launchctl", "bootout", `system/${label}`], tolerate: true }],
    };
  },
};

export const TASKS: Task[] = [
  // ── Telemetry ───────────────────────────────────────────────────────────
  services({
    id: "telemetry",
    group: "telemetry",
    title: "Analytics & telemetry daemons",
    summary: "Usage analytics, diagnostics submission and reporting, power telemetry, ad identifier, differential privacy, experiment (Trial) and feedback services.",
    tier: "lean",
    caveat: "Activity Monitor's Energy tab has no data (PerfPowerServices). analyticsd and osanalyticshelper are force-enabled by launchd and left alone.",
    daemons: [
      "com.apple.rtcreportingd",
      "com.apple.systemstats.analysis",
      "com.apple.symptomsd-diag",
      "com.apple.PerfPowerServices",
      "com.apple.adid",
      "com.apple.diagnosticservicesd",
      "com.apple.corecaptured",
      "com.apple.audioanalyticsd",
      "com.apple.ecosystemanalyticsd",
      "com.apple.wifianalyticsd",
      "com.apple.cloudtelemetryd",
      "com.apple.usbctelemetryd",
      "com.apple.libsqlite3.dbtelemetryd",
      "com.apple.SubmitDiagInfo",
      "com.apple.dprivacyd",
      "com.apple.triald.system",
    ],
    agents: [
      "com.apple.analyticsagent",
      "com.apple.ap.adprivacyd",
      "com.apple.inputanalyticsd",
      "com.apple.geoanalyticsd",
      "com.apple.dprivacyd",
      "com.apple.triald",
      "com.apple.feedbackd",
      "com.apple.loginwindow.LWWeeklyMessageTracer",
      "com.apple.diagnosticextensionsd",
      "com.apple.diagnostics_agent",
    ],
  }),
  prefs({
    id: "analytics-prefs",
    group: "telemetry",
    title: "Analytics sharing off",
    summary: "Turn off 'Share Mac Analytics' and sharing with app developers.",
    tier: "lean",
    scope: "system",
    set: [
      { domain: "/Library/Application Support/CrashReporter/DiagnosticMessagesHistory", key: "AutoSubmit", value: false },
      { domain: "/Library/Application Support/CrashReporter/DiagnosticMessagesHistory", key: "ThirdPartyDataSubmit", value: false },
    ],
  }),

  // ── Apple Intelligence ──────────────────────────────────────────────────
  services({
    id: "apple-intelligence",
    group: "ai",
    title: "Apple Intelligence",
    summary: "On-device models (modelmanagerd hosted a 318 MB inference service), platform, context store, generative features, Private Cloud Compute, Image Playground, writing and translation.",
    tier: "lean",
    daemons: ["com.apple.contextstored", "com.apple.modelmanagerd", "com.apple.modelcatalogd", "com.apple.eligibilityd"],
    agents: [
      "com.apple.ModelCatalogAgent",
      "com.apple.mlhostd",
      "com.apple.intelligenceplatformd",
      "com.apple.intelligencecontextd",
      "com.apple.intelligenceflowd",
      "com.apple.intelligencetasksd",
      "com.apple.intelligentroutingd",
      "com.apple.generativeexperiencesd",
      "com.apple.GenerativeFunctions.agentstored",
      "com.apple.privatecloudcomputed",
      "com.apple.visualintelligenced",
      "com.apple.callintelligenced",
      "com.apple.ContextStoreAgent",
      "com.apple.imageplaygroundd",
      "com.apple.textunderstandingd",
      "com.apple.translationd",
      "com.apple.hybridsearchd",
    ],
  }),

  // ── Siri & speech ───────────────────────────────────────────────────────
  services({
    id: "siri",
    group: "siri",
    title: "Siri & dictation",
    summary: "Siri, its knowledge/inference/TTS services, voice trigger and dictation.",
    tier: "lean",
    caveat: "Shortcuts automations stop working (siriactionsd).",
    daemons: ["com.apple.corespeechd_system"],
    agents: [
      "com.apple.Siri.agent",
      "com.apple.assistantd",
      "com.apple.assistant_service",
      "com.apple.assistant_cdmd",
      "com.apple.siriactionsd",
      "com.apple.siriappintentsd",
      "com.apple.siriinferenced",
      "com.apple.siriknowledged",
      "com.apple.sirittsd",
      "com.apple.SiriTTSTrainingAgent",
      "com.apple.corespeechd",
      "com.apple.DictationIM",
    ],
  }),
  prefs({
    id: "siri-prefs",
    group: "siri",
    title: "Siri settings off",
    summary: "Turn Siri, its menu bar item and 'Hey Siri' off in preferences, so nothing asks to re-enable them.",
    tier: "lean",
    scope: "user",
    set: [
      { domain: "com.apple.assistant.support", key: "Assistant Enabled", value: false },
      { domain: "com.apple.Siri", key: "StatusMenuVisible", value: false },
      { domain: "com.apple.Siri", key: "VoiceTriggerUserEnabled", value: false },
    ],
  }),
  services({
    id: "speech-text",
    group: "siri",
    title: "Speech synthesis & spell-check",
    summary: "Text-to-speech engines, speech data maintenance, live transcription and the spell-checker (125 MB at first boot).",
    tier: "host",
    caveat: "No spell-check or text-to-speech on the host (simulators carry their own).",
    agents: [
      "com.apple.speech.speechdatainstallerd",
      "com.apple.speechmaintenanced",
      "com.apple.speech.speechsynthesisd.arm64",
      "com.apple.speech.speechsynthesisd.x86_64",
      "com.apple.speech.synthesisserver",
      "com.apple.accessibility.heard",
      "com.apple.accessibility.LiveTranscriptionAgent",
      "com.apple.applespell",
    ],
  }),

  // ── Suggestions & knowledge ─────────────────────────────────────────────
  services({
    id: "suggestions",
    group: "knowledge",
    title: "Suggestions, knowledge & Biome",
    summary: "Siri Suggestions, knowledge graph, proactive and routine prediction, Biome event streams, Tips and Help.",
    tier: "lean",
    daemons: ["com.apple.biomed"],
    agents: [
      "com.apple.suggestd",
      "com.apple.knowledge-agent",
      "com.apple.knowledgeconstructiond",
      "com.apple.parsecd",
      "com.apple.parsec-fbf",
      "com.apple.duetexpertd",
      "com.apple.proactived",
      "com.apple.proactiveeventtrackerd",
      "com.apple.BiomeAgent",
      "com.apple.biomesyncd",
      "com.apple.routined",
      "com.apple.peopled",
      "com.apple.tipsd",
      "com.apple.followupd",
      "com.apple.FollowUpUI",
      "com.apple.helpd",
      "com.apple.linkd",
    ],
  }),

  // ── Media ───────────────────────────────────────────────────────────────
  services({
    id: "media-analysis",
    group: "media",
    title: "Photo & media analysis",
    summary: "Face/scene analysis and the Photos library (mediaanalysisd held 300 MB at first boot).",
    tier: "lean",
    agents: ["com.apple.photoanalysisd", "com.apple.mediaanalysisd", "com.apple.photolibraryd", "com.apple.cloudphotod"],
  }),
  services({
    id: "media-apps",
    group: "media",
    title: "Music, TV & Shazam",
    summary: "Music/TV library and device agents, media sharing, Apple TV remote, Shazam.",
    tier: "lean",
    daemons: ["com.apple.musicd"],
    agents: [
      "com.apple.AMPArtworkAgent",
      "com.apple.AMPDeviceDiscoveryAgent",
      "com.apple.AMPDevicesAgent",
      "com.apple.AMPLibraryAgent",
      "com.apple.AMPSystemPlayerAgent",
      "com.apple.amp.mediasharingd",
      "com.apple.itunescloudd",
      "com.apple.tvremoted",
      "com.apple.shazamd",
      "com.apple.shazameventsd",
    ],
  }),

  // ── Consumer apps ───────────────────────────────────────────────────────
  services({
    id: "consumer",
    group: "consumer",
    title: "Widgets, Game Center, Screen Time, Home, Books…",
    summary: "Widgets, News, Weather, Maps, Clock, Books, Game Center and game controllers, Screen Time, Family, Classroom, Home/Thread, Reminders, Wallet, stickers, Live Activities, App Store promoted content.",
    tier: "lean",
    daemons: ["com.apple.familycontrols", "com.apple.GameController.gamecontrollerd", "com.apple.gamepolicyd"],
    agents: [
      "com.apple.ManagedSettingsAgent",
      "com.apple.chronod",
      "com.apple.newsd",
      "com.apple.weatherd",
      "com.apple.Maps.mapssyncd",
      "com.apple.Maps.mapspushd",
      "com.apple.maps.destinationd",
      "com.apple.gamed",
      "com.apple.ScreenTimeAgent",
      "com.apple.ScreenTimeSettingsAgent",
      "com.apple.familycircled",
      "com.apple.homed",
      "com.apple.remindd",
      "com.apple.financed",
      "com.apple.passd",
      "com.apple.frauddefensed",
      "com.apple.homeenergyd",
      "com.apple.homeeventsd",
      "com.apple.ThreadCommissionerService",
      "com.apple.mobiletimerd",
      "com.apple.UsageTrackingAgent",
      "com.apple.FamilyControlsAgent",
      "com.apple.askpermissiond",
      "com.apple.studentd",
      "com.apple.GameController.gamecontrolleragentd",
      "com.apple.ap.promotedcontentd",
      "com.apple.amsondevicestoraged",
      "com.apple.jetpackassetd",
      "com.apple.bookassetd",
      "com.apple.bookdatastored",
      "com.apple.stickersd",
      "com.apple.avatarsd",
      "com.apple.liveactivitiesd",
      "com.apple.replicatord",
      "com.apple.synapse.contentlinkingd",
      "com.apple.voicebankingd",
      "com.apple.betaenrollmentagent",
      "com.apple.guidedbrowsingd",
      "com.apple.milod",
    ],
  }),
  services({
    id: "safari",
    group: "consumer",
    title: "Safari background agents",
    summary: "Safari history, Safe Browsing, password breach checks, notifications and bookmark sync.",
    tier: "host",
    caveat: "Safari still launches, but Safe Browsing and history sync are off. Skip this if CI runs Safari web tests.",
    agents: [
      "com.apple.Safari.History",
      "com.apple.Safari.PasswordBreachAgent",
      "com.apple.Safari.SafeBrowsing.Service",
      "com.apple.SafariHistoryServiceAgent",
      "com.apple.SafariLaunchAgent",
      "com.apple.SafariNotificationAgent",
      "com.apple.SafariBookmarksSyncAgent",
    ],
  }),

  services({
    id: "app-store",
    group: "consumer",
    title: "App Store",
    summary: "App Store daemons and agents, app placeholders, managed app distribution and media-services accounts.",
    tier: "host",
    caveat: "The App Store can't install or update apps. Install Xcode with xcodes or from developer.apple.com.",
    daemons: ["com.apple.appstored", "com.apple.managedappdistributiond"],
    agents: ["com.apple.appstoreagent", "com.apple.amsaccountsd", "com.apple.appplaceholdersyncd"],
  }),

  // ── Communication ───────────────────────────────────────────────────────
  services({
    id: "communication",
    group: "communication",
    title: "Mail, Messages, FaceTime, Contacts & Calendar",
    summary: "Messages, FaceTime and call history, Continuity Camera, Mail, Exchange/CalDAV sync, Contacts, Calendar and Notes sync.",
    tier: "host",
    agents: [
      "com.apple.imagent",
      "com.apple.imcore.imtransferagent",
      "com.apple.facetimemessagestored",
      "com.apple.messagesescrowd",
      "com.apple.telephonyutilities.callservicesd",
      "com.apple.email.maild",
      "com.apple.exchange.exchangesyncd",
      "com.apple.icloudmailagent",
      "com.apple.mdworker.mail",
      "com.apple.contactsd",
      "com.apple.contacts.donation-agent",
      "com.apple.contacts.postersyncd",
      "com.apple.calaccessd",
      "com.apple.dataaccess.dataaccessd",
      "com.apple.CallHistoryPluginHelper",
      "com.apple.CommCenter",
      "com.apple.avconferenced",
      "com.apple.cmio.ContinuityCaptureAgent",
      "com.apple.videoconference.camera",
      "com.apple.sociallayerd",
      "com.apple.StatusKitAgent",
      "com.apple.notes.exchangenotesd",
      "com.apple.LinkedNotesUIService",
      "com.apple.transparencyd",
      "com.apple.swtransparencyd",
    ],
  }),

  // ── iCloud ──────────────────────────────────────────────────────────────
  services({
    id: "icloud",
    group: "icloud",
    title: "iCloud",
    summary: "iCloud Drive (bird), CloudKit (cloudd), File Provider, iCloud Keychain escrow, settings sync and iCloud notifications.",
    tier: "host",
    caveat: "iCloud Drive, iCloud Keychain, CloudKit and File Provider cloud drives stop. Xcode's Apple ID signing uses akd, which stays on.",
    daemons: ["com.apple.cloudd"],
    agents: [
      "com.apple.bird",
      "com.apple.cloudd",
      "com.apple.cloudsettingssyncagent",
      "com.apple.iCloudNotificationAgent",
      "com.apple.iCloudUserNotificationsd",
      "com.apple.icloudwebd",
      "com.apple.syncdefaultsd",
      "com.apple.cksharingmanagementd",
      "com.apple.cmfsyncagent",
      "com.apple.FileProvider",
      "com.apple.cdpd",
      "com.apple.SecureBackupDaemon",
      "com.apple.protectedcloudstorage.protectedcloudkeysyncing",
    ],
  }),
  services({
    id: "find-my",
    group: "icloud",
    title: "Find My",
    summary: "Find My Mac, the Find My network (searchpartyd), beaconing and location agents.",
    tier: "host",
    caveat: "The Mac can't be located, locked or erased remotely through Find My.",
    daemons: [
      "com.apple.findmy.findmybeaconingd",
      "com.apple.findmymacd",
      "com.apple.findmymacmessenger",
      "com.apple.icloud.findmydeviced",
      "com.apple.icloud.searchpartyd",
    ],
    agents: [
      "com.apple.findmy.findmylocateagent",
      "com.apple.findmymacmessenger",
      "com.apple.icloud.findmydeviced.findmydevice-user-agent",
      "com.apple.icloud.searchpartyuseragent",
    ],
  }),

  // ── Continuity ──────────────────────────────────────────────────────────
  services({
    id: "continuity",
    group: "continuity",
    title: "AirDrop, Handoff & AirPlay",
    summary: "sharingd, rapportd, Handoff (useractivityd), Wi-Fi peer-to-peer (AWDL), nearby interaction and the AirPlay receiver.",
    tier: "host",
    caveat: "No AirDrop, Handoff, Universal Clipboard, Sidecar or AirPlay receiver; wireless pairing of physical iOS devices won't work (USB still does). Normal Wi-Fi and Screen Sharing are unaffected.",
    daemons: ["com.apple.rapportd", "com.apple.AirPlayXPCHelper", "com.apple.nearbyd", "com.apple.wifip2pd"],
    agents: ["com.apple.sharingd", "com.apple.rapportd", "com.apple.AirPlayUIAgent", "com.apple.coreservices.useractivityd"],
  }),
  prefs({
    id: "handoff-prefs",
    group: "continuity",
    title: "Handoff off",
    summary: "Stop advertising and receiving Handoff activities.",
    tier: "host",
    scope: "host",
    set: [
      { domain: "com.apple.coreservices.useractivityd", key: "ActivityAdvertisingAllowed", value: false },
      { domain: "com.apple.coreservices.useractivityd", key: "ActivityReceivingAllowed", value: false },
    ],
  }),

  // ── Desktop shell ───────────────────────────────────────────────────────
  services({
    id: "desktop-shell",
    group: "desktop",
    title: "Notification Center, Finder, wallpaper…",
    summary: "Notification Center, wallpaper, Finder, Quick Look thumbnails, input menus, Focus and Now Playing. WindowManager, Control Center and the menu bar agent are kept: the login session needs them.",
    tier: "host",
    caveat: "No desktop, Finder windows or notification banners. Apps, Simulator and Screen Sharing still work; manage files over SSH.",
    // WallpaperAgent spawns the Wallpaper*Extension processes; they go with it.
    daemons: ["com.apple.wallpaper.export", "com.apple.mediaremoted", "com.apple.systemstatusd", "com.apple.audio.systemsoundserverd"],
    agents: [
      "com.apple.talagent",
      "com.apple.imklaunchagent",
      "com.apple.CoreLocationAgent",
      "com.apple.geodMachServiceBridge",
      "com.apple.accessibility.axassetsd",
      "com.apple.FeatureAccessAgent",
      "com.apple.SoftwareUpdateNotificationManager",
      "com.apple.notificationcenterui.agent",
      "com.apple.TextInputMenuAgent",
      "com.apple.TextInputSwitcher",
      "com.apple.wallpaper.agent",
      "com.apple.Finder",
      "com.apple.quicklook.ThumbnailsAgent",
      "com.apple.donotdisturbd",
      "com.apple.mediaremoteagent",
      "com.apple.colorsync.useragent",
    ],
  }),
  services({
    id: "dock",
    group: "desktop",
    title: "Dock",
    summary: "The Dock and its helpers (DockHelper, dock extras).",
    tier: "host",
    caveat: "No Dock, Mission Control, Spaces, ⌘-Tab switcher or full-screen windows. Windows still open and Simulator still runs.",
    agents: ["com.apple.Dock.agent"],
  }),
  services({
    id: "core-audio",
    group: "desktop",
    title: "Core Audio (experimental)",
    summary: "The audio server (coreaudiod, ~100 MB) and audio component registry. Nothing on a headless host plays sound.",
    tier: "max",
    caveat: "Untested: Simulator, apps and tests that touch audio may stall or fail. Try alone with --only core-audio and reboot; undo with restore --only core-audio.",
    daemons: ["com.apple.audio.coreaudiod", "com.apple.audio.AudioComponentRegistrar"],
    agents: ["com.apple.audio.AudioComponentRegistrar"],
  }),
  keepTerminal,

  // ── Hardware ────────────────────────────────────────────────────────────
  services({
    id: "hardware",
    group: "hardware",
    title: "Cameras, Touch ID, NFC, smart cards…",
    summary: "Bluetooth cloud pairing, cameras and video capture, Touch ID, NFC and Secure Element, smart cards, Image Capture, USB audio, accessory firmware updates, battery UI.",
    tier: "host",
    caveat: "No cameras, Touch ID, smart cards or USB audio devices.",
    // bluetoothd stays: with it disabled, coreaudiod's Bluetooth audio plugin
    // restarts every few seconds and leaks ~55 MB/min (found 2026-10-11).
    daemons: [
      "com.apple.cameracaptured",
      "com.apple.cmio.VDCAssistant",
      "com.apple.cmio.registerassistantservice",
      "com.apple.cmio.uvcassistantextension",
      "com.apple.cmio.videodriverkithostextension",
      "com.apple.biometrickitd",
      "com.apple.nfcd",
      "com.apple.seld",
      "com.apple.ifdreader",
      "com.apple.usbaudiod",
      "com.apple.uarpd",
      "com.apple.uarpassetmanagerd",
      "com.apple.PowerUIAgent",
      // accessoryupdaterd runs the five UARPUpdaterService* processes.
      "com.apple.accessoryupdaterd",
      "com.apple.accessoryaccessd",
      "com.apple.liquiddetectiond",
    ],
    agents: ["com.apple.BTServer.cloudpairing", "com.apple.icdd"],
  }),

  // ── Enterprise & network services ───────────────────────────────────────
  services({
    id: "enterprise",
    group: "network",
    title: "Enterprise SSO, MDM & Windows file sharing",
    summary: "Enterprise single sign-on, declarative device management, exam mode, SMB/NetBIOS name and domain services, automounts.",
    tier: "host",
    caveat: "No enterprise SSO extensions or declarative MDM (restore before enrolling), no SMB name lookups or /net automounts. SSH and Screen Sharing are unaffected.",
    daemons: [
      "com.apple.AppSSODaemon",
      "com.apple.remotemanagementd",
      "com.apple.netbiosd",
      "com.apple.msrpc.netlogon",
      "com.apple.autofsd",
      "com.apple.automountd",
      "com.apple.mdmclient.daemon",
    ],
    agents: ["com.apple.AppSSOAgent", "com.apple.assessmentagent", "com.apple.mdmclient.agent"],
  }),
  services({
    id: "maintenance",
    group: "network",
    title: "Content caching, captive portals & repair",
    summary: "Content caching, captive-portal detection, Migration Assistant, parts repair, document versions, app prewarming and audio history.",
    tier: "host",
    caveat: "No captive-portal login sheet (wired or known networks only), no document version history.",
    daemons: [
      "com.apple.AssetCache.builtin",
      "com.apple.AssetCacheManagerService",
      "com.apple.AssetCacheTetheratorService",
      "com.apple.captiveagent",
      "com.apple.installandsetup.systemmigrationd",
      "com.apple.corerepaird",
      "com.apple.revisiond",
      "com.apple.warmd",
      "com.apple.audio.isolated.historicalaudiod",
    ],
    agents: ["com.apple.mobilerepaird"],
  }),

  // ── Spotlight ───────────────────────────────────────────────────────────
  spotlightIndex,
  services({
    id: "spotlight-ui",
    group: "spotlight",
    title: "Spotlight UI & Core Spotlight",
    summary: "The ⌘-Space UI, in-app Core Spotlight indexing and Spotlight knowledge updaters. The mds daemons are left alone.",
    tier: "host",
    agents: [
      "com.apple.Spotlight",
      "com.apple.campo",
      "com.apple.corespotlightd",
      "com.apple.corespotlightservice",
      "com.apple.managedcorespotlightd",
      "com.apple.spotlightknowledged",
      "com.apple.spotlightknowledged.importer",
      "com.apple.spotlightknowledged.updater",
    ],
  }),

  // ── Host behaviour ──────────────────────────────────────────────────────
  remoteLogin,
  power({
    id: "power",
    group: "host",
    title: "Always on",
    summary: "Never sleep or spin down disks, no Power Nap, restart after power loss, wake on network.",
    tier: "lean",
    set: { sleep: 0, disksleep: 0, powernap: 0, autorestart: 1, womp: 1 },
  }),
  prefs({
    id: "updates",
    group: "host",
    title: "Pin macOS & app versions",
    summary: "Keep checking for updates and installing security data (XProtect, RSR), but never install macOS or App Store updates on their own.",
    tier: "host",
    caveat: "softwareupdated keeps running; you upgrade macOS and Xcode deliberately (softwareupdate -i, xcodes).",
    scope: "system",
    set: [
      { domain: "/Library/Preferences/com.apple.SoftwareUpdate", key: "AutomaticCheckEnabled", value: true },
      { domain: "/Library/Preferences/com.apple.SoftwareUpdate", key: "CriticalUpdateInstall", value: true },
      { domain: "/Library/Preferences/com.apple.SoftwareUpdate", key: "ConfigDataInstall", value: true },
      { domain: "/Library/Preferences/com.apple.SoftwareUpdate", key: "AutomaticallyInstallMacOSUpdates", value: false },
      { domain: "/Library/Preferences/com.apple.commerce", key: "AutoUpdate", value: false },
    ],
  }),
  services({
    id: "time-machine",
    group: "host",
    title: "Time Machine",
    summary: "Backup daemons and local snapshots. CI hosts are rebuilt, not restored.",
    tier: "host",
    daemons: ["com.apple.backupd", "com.apple.backupd-helper"],
  }),
  prefs({
    id: "interface",
    group: "host",
    title: "Reduce motion & transparency",
    summary: "Reduce motion and transparency and turn off window animations, so WindowServer does less work.",
    tier: "host",
    scope: "user",
    tolerant: true,
    set: [
      { domain: "com.apple.universalaccess", key: "reduceMotion", value: true },
      { domain: "com.apple.universalaccess", key: "reduceTransparency", value: true },
      { domain: "NSGlobalDomain", key: "NSAutomaticWindowAnimationsEnabled", value: false },
    ],
  }),
  prefs({
    id: "screensaver",
    group: "host",
    title: "No screensaver",
    summary: "Disable the screensaver so UI tests and Screen Sharing never land on it.",
    tier: "host",
    scope: "host",
    set: [{ domain: "com.apple.screensaver", key: "idleTime", value: 0 }],
  }),

  // ── Storage ─────────────────────────────────────────────────────────────
  remove({
    id: "bundled-apps",
    group: "storage",
    title: "Bundled creative apps",
    summary: "GarageBand, iMovie, Keynote, Numbers and Pages with their sound libraries (≈8 GB).",
    tier: "host",
    caveat: "Deleted, not disabled. Reinstall from the App Store if ever needed.",
    paths: [
      "/Applications/GarageBand.app",
      "/Applications/iMovie.app",
      "/Applications/Keynote Creator Studio.app",
      "/Applications/Numbers Creator Studio.app",
      "/Applications/Pages Creator Studio.app",
      "/Applications/Keynote.app",
      "/Applications/Numbers.app",
      "/Applications/Pages.app",
      "/Library/Application Support/GarageBand",
      "/Library/Application Support/Logic",
      "/Library/Audio/Apple Loops",
      "/Library/Audio/Impulse Responses",
    ],
  }),
];

/** Throws if the catalog is malformed or names a protected label. */
export function validate(tasks: Task[]): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    ids.add(task.id);
    for (const label of task.labels ?? []) {
      const why = protection(label);
      if (why) throw new Error(`task ${task.id} names protected label ${label} (${why})`);
    }
  }
}

validate(TASKS);

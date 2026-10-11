export const softwareUpdateDomain = "/Library/Preferences/com.apple.SoftwareUpdate";

export const softwareUpdatePolicy: Record<string, boolean> = {
  AutomaticDownload: true,
  AutomaticallyInstallMacOSUpdates: false,
  ConfigDataInstall: true,
  CriticalUpdateInstall: true,
};

export const isAutomaticCheckOn = (scheduleOutput: string) => /automatic checking for updates is turned on/i.test(scheduleOutput);

// electron-builder's afterPack hook: turns off the Electron features an attacker could use to run their own code
// through the app (ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect), and makes it load only its own app.asar. It runs
// before signing, so the signature covers the flipped fuses; `npx @electron/fuses read --app <path>` shows them.
import path from 'node:path';
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';

/** @param {import('electron-builder').AfterPackContext} context */
export default async function setFuses(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const name = packager.appInfo.productFilename;
  const executable =
    electronPlatformName === 'darwin' || electronPlatformName === 'mas'
      ? path.join(appOutDir, `${name}.app`)
      : electronPlatformName === 'win32'
        ? path.join(appOutDir, `${name}.exe`)
        : electronPlatformName === 'linux'
          ? path.join(appOutDir, packager.executableName)
          : null;
  if (!executable) throw new Error(`No fuses for ${electronPlatformName}.`);
  await flipFuses(executable, {
    version: FuseVersion.V1,
    // The ad-hoc signature an arm64 Electron ships with no longer matches once a fuse flips.
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: packager.config.asar !== false,
  });
}

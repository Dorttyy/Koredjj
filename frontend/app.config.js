/* eslint-env node */
/* global __dirname */
const fs = require("fs");
const path = require("path");
try {
  require("dotenv").config({ path: path.resolve(__dirname, ".env") });
} catch {}

/**
 * Resolve the Firebase `google-services.json` that should be bundled into the
 * Android build.
 *
 * The Google Services Gradle plugin aborts the whole Android build when the
 * final `applicationId` has no matching `client` entry inside the JSON
 * ("No matching client found for package name ..."). Build pipelines can
 * rewrite `android.package` at build time, so instead of failing late inside
 * Gradle we validate here (at config-evaluation time) and only attach the file
 * when it actually contains the package being built. Push notifications need
 * the file, so a loud warning is printed whenever it has to be dropped.
 *
 * Precedence:
 *   1. GOOGLE_SERVICES_JSON env var (EAS "file" secret convention) if it exists
 *   2. android.googleServicesFile from app.json (./google-services.json)
 */
function resolveGoogleServicesFile(androidConfig) {
  // Each candidate keeps the ORIGINAL value that should be written back into the
  // config (`value`) separate from the absolute path used for local validation
  // (`absolute`). Build pipelines may evaluate this config in one directory,
  // write the resolved config to app.json, then build in another directory —
  // so an absolute path must never leak into the resolved config.
  const candidates = [];
  if (process.env.GOOGLE_SERVICES_JSON) {
    candidates.push({
      value: process.env.GOOGLE_SERVICES_JSON,
      absolute: path.resolve(process.env.GOOGLE_SERVICES_JSON),
    });
  }
  if (androidConfig.googleServicesFile) {
    const raw = String(androidConfig.googleServicesFile);
    let absolute = path.isAbsolute(raw) ? raw : path.resolve(__dirname, raw);
    // A previously resolved config may carry an absolute path from another
    // machine; fall back to the same file name inside this project directory.
    if (!fs.existsSync(absolute)) {
      const local = path.join(__dirname, path.basename(raw));
      if (fs.existsSync(local)) absolute = local;
    }
    // Normalise absolute paths back to a project-relative path when the file
    // lives inside this project so the resolved config stays portable.
    const rel = path.relative(__dirname, absolute);
    const value =
      rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? `./${rel.split(path.sep).join("/")}` : raw;
    candidates.push({ value, absolute });
  }

  const targetPackage = androidConfig.package;
  for (const { value, absolute: candidate } of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    let packages = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      packages = (parsed.client || [])
        .map((c) => c && c.client_info && c.client_info.android_client_info)
        .filter(Boolean)
        .map((info) => info.package_name)
        .filter(Boolean);
    } catch (err) {
      console.warn(
        `[app.config] Ignoring unreadable google-services file ${candidate}: ${err.message}`,
      );
      continue;
    }
    if (!targetPackage || packages.includes(targetPackage)) {
      return value;
    }
    console.warn(
      `[app.config] google-services.json at ${candidate} has no Android client for ` +
        `package "${targetPackage}" (found: ${packages.join(", ") || "none"}).`,
    );
  }

  if (candidates.length > 0) {
    console.warn(
      "[app.config] Building WITHOUT google-services.json so the Android build can " +
        "succeed. Firebase push notifications will be unavailable in this build. " +
        `Register package "${targetPackage}" in the Firebase project and replace ` +
        "frontend/google-services.json to re-enable them.",
    );
  }
  return undefined;
}

module.exports = ({ config }) => {
  const android = { ...(config.android || {}) };
  const googleServicesFile = resolveGoogleServicesFile(android);
  if (googleServicesFile) {
    android.googleServicesFile = googleServicesFile;
  } else {
    delete android.googleServicesFile;
  }

  return {
    ...config,
    android,
    extra: {
      ...config.extra,
      backendUrl: (() => {
        let u = process.env.EXPO_PUBLIC_BACKEND_URL || config.extra?.backendUrl || "";
        if (!u) {
          try {
            const envP = path.resolve(__dirname, ".env");
            if (fs.existsSync(envP)) {
              const c = fs.readFileSync(envP, "utf8");
              const m = c.match(/EXPO_PUBLIC_BACKEND_URL=["']?([^"'\r\n]+)/);
              if (m && m[1]) u = m[1].trim();
            }
          } catch {}
        }
        // Loud build-log guard: a native binary baked with a workspace-only
        // host (preview/tunnel/localhost/LAN IP) can never reach a server from
        // a real phone -> users would see "Can't reach the server". The managed
        // publish pipeline normally rewrites EXPO_PUBLIC_BACKEND_URL to the
        // deployed https://<app>.emergent.host value; if that did not happen we
        // must not fail silently.
        const host = String(u).replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
        const ephemeral =
          !!host &&
          (/\.preview\.emergentagent\.com(:\d+)?$/.test(host) ||
            /\.ngrok(-free)?\.(app|io|dev)(:\d+)?$/.test(host) ||
            /\.exp\.direct(:\d+)?$/.test(host) ||
            /^(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2)(:\d+)?$/.test(host) ||
            /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host));
        if (!u) {
          console.warn(
            "[app.config] EXPO_PUBLIC_BACKEND_URL is EMPTY — a native build made now would have no server address. Deploy the app (Publish) before building the APK/IPA.",
          );
        } else if (ephemeral) {
          console.warn(
            `[app.config] EXPO_PUBLIC_BACKEND_URL points at the temporary workspace host "${host}". That is fine for the web preview and Expo Go on the same network, but an installed APK/IPA built with it can NEVER reach the server. Deploy the app (Publish) so the pipeline injects the permanent *.emergent.host URL before building a binary.`,
          );
        }
        return u;
      })(),
      revenueCat: {
        testApiKey: process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY,
        iosApiKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
        androidApiKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
      },
    },
  };
};

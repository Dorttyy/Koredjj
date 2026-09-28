/**
 * Legacy `/dev-diagnostics` route.
 *
 * The diagnostics screen now ships in RELEASE builds as `/connection-check`
 * (an installed APK has no console, so the report has to live in the app).
 * This file is kept only so older links / bookmarks keep working.
 */

import { Redirect } from "expo-router";
import React from "react";

export default function DevDiagnosticsRedirect() {
  return <Redirect href="/connection-check" />;
}

/* eslint-env node */
/**
 * Expo config plugin — resilient OkHttp client for ALL app networking on Android.
 *
 * WHY (root cause of the installed-APK "Can't reach the server" bug):
 * React Native creates its shared OkHttpClient with NO timeouts at all
 * (connect/read/write = 0) and NO HTTP/2 ping. Expo's global `fetch`
 * (ExpoFetchModule) builds its client from the same
 * `OkHttpClientProvider.createClient(context)`, so it inherits that config.
 *
 * Our API sits behind Cloudflare, which speaks HTTP/2, so every request
 * is multiplexed over ONE pooled connection. When a phone sits idle for a
 * minute (e.g. filling in onboarding), a mobile carrier / router NAT silently
 * drops that idle TCP connection. OkHttp only notices a dead HTTP/2 connection
 * via a "degraded ping", which is only sent after a READ TIMEOUT — and there is
 * none. JS-side aborts just RST the stream and leave the dead connection in
 * the pool, so EVERY later request is written into the dead socket and hangs
 * until the OS gives up minutes later: sign-up works, then the app "can't reach
 * the server" although the server is perfectly healthy.
 *
 * FIX: register an OkHttpClientFactory at Application start that keeps RN's
 * defaults (cookie jar, 10 MB cache) and adds:
 *   - pingInterval 10 s : HTTP/2 PINGs keep carrier NAT mappings alive AND a
 *                         connection that stops answering is failed + evicted
 *                         within seconds instead of being reused forever
 *                         (reproduced: default client failed every request
 *                         after a silent drop; this one recovered in < 10 s);
 *   - connect 15 s / read 60 s / write 60 s timeouts : nothing can hang
 *                         forever, yet slow uploads/AI replies still fit;
 *   - a connection pool with a 60 s keep-alive, so stale sockets are not kept.
 * `retryOnConnectionFailure` stays enabled (OkHttp default) so a request that
 * hits a dead pooled socket is transparently retried on a new connection.
 */
const { withMainApplication } = require("expo/config-plugins");

const MARKER = "// [mello] resilient OkHttp client";

const FACTORY_KOTLIN = `    ${MARKER} — see plugins/withResilientOkHttp.js
    com.facebook.react.modules.network.OkHttpClientProvider.setOkHttpClientFactory(
      com.facebook.react.modules.network.OkHttpClientFactory {
        com.facebook.react.modules.network.OkHttpClientProvider
          .createClientBuilder(applicationContext)
          .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
          .readTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
          .writeTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
          .pingInterval(10, java.util.concurrent.TimeUnit.SECONDS)
          .connectionPool(okhttp3.ConnectionPool(5, 60, java.util.concurrent.TimeUnit.SECONDS))
          .retryOnConnectionFailure(true)
          .build()
      }
    )
`;

function addFactory(contents) {
  if (contents.includes(MARKER)) return contents;
  // Register the factory as the very first statement of onCreate(), before
  // React Native (and any native module) can create its HTTP client.
  const onCreate = /override fun onCreate\(\)\s*\{\s*\n/;
  if (!onCreate.test(contents)) {
    throw new Error(
      "[withResilientOkHttp] Could not find `override fun onCreate() {` in MainApplication.kt",
    );
  }
  return contents.replace(onCreate, (match) => `${match}${FACTORY_KOTLIN}`);
}

module.exports = function withResilientOkHttp(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== "kt") {
      throw new Error(
        `[withResilientOkHttp] Expected a Kotlin MainApplication, got ${cfg.modResults.language}`,
      );
    }
    cfg.modResults.contents = addFactory(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.addFactory = addFactory;

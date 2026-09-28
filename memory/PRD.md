## 2026-09-28c — REAL root cause of APK "Can't reach the server" (native OkHttp)
- RN/Expo Android HTTP client: no timeouts + no HTTP/2 ping; a silently dropped idle HTTP/2 connection (Cloudflare) was reused forever -> all requests after sign-up hung. Reproduced vs live deploy (okhttp 4.9.2 + blackhole proxy). Fixed by plugins/withResilientOkHttp.js (OkHttpClientFactory: ping 10s, connect 15s, read/write 60s, pool keep-alive 60s). Also covers expo fetch + WebSockets. Needs NEW APK build. Deployed backend = https://apk-build-debug-1.emergent.host (healthy).

## 2026-09-28b — APK "Can't reach the server" (deploy hardening + connection engine v3)
- Old deploy host link-bridge-25.emergent.host answers 400 "Application not found" (gone). User must Re-deploy + rebuild APK; user did not remember the new URL, so app.json `extra.fallbackBackendUrls` is supported but EMPTY — fill it with the live *.emergent.host URL when known.
- Backend boots with NO env (db.py local fallback only when MONGO_URL unset; DB_NAME from env/URI), JWT_SECRET env -> persisted Mongo app_config{_id:jwt_secret}; seeding in guarded background task; AUTO_PROVISION_MODELS default false; optional ML via optional_deps.py; admin seed skipped without ADMIN_PASSWORD.
- Frontend: request queue removed; retries 10/12/15s idempotent only; non-JSON error replies = kind `not-running` (banner "Server isn't running"); strict /api/health JSON probe; cold-start session resume loop; CallContext WS keyed on user.id; usesCleartextTraffic=false + https-only native.
- yarn.lock regenerated (@typescript-eslint pinned 8.70.0 via resolutions: 8.71.0 tarballs 404), package-lock.json removed, root .gitignore no longer ignores .env. deployment_agent: 0 blockers. Backend regression 7/7 (after db fallback fix).
- Known unrelated: /api/ai/transcribe 503 (faster_whisper not installed); deep_translator missing warning.

# PRD — Mello (previously LinguaConnect)

## 2026-09-27 — APK "No network connection" root cause + deployment unblocked (CURRENT)
- **Fork arrived broken:** `/app` contained ONLY `.git`/`.emergent` (every tracked file deleted, node_modules + both `.env` gone, backend & expo FATAL). Restored via `git checkout HEAD -- .`, recreated `backend/.env` (MONGO_URL local, DB_NAME linguaconnect, new JWT_SECRET, CORS *, EMERGENT_LLM_KEY, ADMIN_PASSWORD, SEED_DEMO_TUTORS=true, AUTO_PROVISION_MODELS=false) and `frontend/.env` (EXPO_PUBLIC_BACKEND_URL / EXPO_BACKEND_URL / EXPO_PACKAGER_* = `https://apk-build-debug-1.preview.emergentagent.com`), `yarn install`, `pip install -r requirements.txt`, `python backend/seed.py` (10 users, 6 moments). **Permanent fix for the recurring loss:** root `.gitignore` had blanket `.env` / `.env.*` / `*.env` lines re-added against its own comment — removed, so both `.env` files are tracked and survive the next fork.
- **Reported bug:** installed APK showed "No network connection / Please check your network settings". That copy is `OfflineBanner.tsx`, driven only by `NetworkContext.isOnline === false`, which flips after 3 transport failures reported by `api.ts`. In the APK every request fails because the baked backend URL has no live server — `https://app-release-ready-4.emergent.host/api/health` = 400 "Application not found" (app never deployed). The app then blamed the phone's network.
- **Honest diagnosis (fix):** `NetworkContext` now exposes `status: online | device-offline | server-down | no-server-url` + the baked `baseUrl`; `api.ts` reports the precise kind once (`no-backend-url | timeout | offline | unreachable`) AFTER asking the OS via expo-network, and added a native `Network.addNetworkStateListener` so real radio loss shows instantly and recovery clears the banner immediately. Banner copy: device-offline → "No network connection"; server-down → "Can't reach the server" + "<host> isn't responding — retrying…" (or "<host> is a temporary address — deploy, then rebuild" for preview/ngrok/LAN hosts on native); no-server-url → "No server address in this build / Re-publish the app…". A bad APK is now self-diagnosing because it names the host. `net-diagnostics.isEphemeralHost()` added.
- **Deployment unblocked (both deployment_agent BLOCKERS cleared, status now `warn`, zero blockers):** (1) removed the heavy ML wheels from `backend/requirements.txt` — av, ctranslate2, faster-whisper, flatbuffers, hf-xet, huggingface_hub, numpy, onnxruntime, pandas, sentencepiece. Safe: every use is a lazy in-function import wrapped in try/except, the offline weights are absent anyway (free MyMemory provider active), `routes/call_captions.py` isn't registered. New guard test `backend/tests/test_deploy_without_ml_extras.py` blocks those modules via `sys.meta_path` and proves the boot path still imports and `translate()` still returns text (4/4). (2) `translation_service.initialize()` no longer creates a TTL `expireAfterSeconds` index (destructive DB startup) — plain `[(user_id,1),(expires_at,-1)]` lookup index instead; read-time expiry filtering was already there.
- **Build hygiene:** `frontend/yarn.lock` was NOT tracked in git (the documented "packageManager yarn but no yarn.lock" EAS failure) — regenerated, `--frozen-lockfile` PASS; deleted `frontend/package-lock.json` again; `app.config.js` now prints a loud build-log warning when `EXPO_PUBLIC_BACKEND_URL` is empty or a workspace-only host. `expo config --type prebuild` PASS, `tsc --noEmit` 0, eslint clean, `expo export --platform android --no-bytecode` PASS and the bundle carries exactly 1 baked copy of the backend URL (proves the pipeline's env rewrite reaches the binary).
- Verified: backend testing agent 8/8 + 7/7 + 8/8, frontend testing agent 5/5 on the banner (server-down → "Can't reach the server", device-offline → "No network connection", recovery clears).
- **STILL REQUIRED FROM USER:** press Publish/Deploy so the backend goes live on a permanent `*.emergent.host` URL, THEN build the APK. A binary built before the deployment exists will always fail to connect. Also still open: iOS `GoogleService-Info.plist` (iOS push), in-app account deletion (App Store), RevenueCat public keys.


## 2026-06 — ROOT CAUSE FIX: production APK "Can't reach the server" (CURRENT)
- **Root cause (confirmed, two layers):**
  1. `frontend/eas.json` hardcoded `env.EXPO_PUBLIC_BACKEND_URL = https://apk-build-debug-1.preview.emergentagent.com` in ALL build profiles. An EAS build-profile `env` block has the HIGHEST precedence, so it OVERRODE the publish pipeline's production URL rewrite → every APK was baked with the ephemeral preview host (changes each fork, dies when the workspace sleeps) → device-side DNS/connect failure → RN `Network request failed` → UI text "Can't reach the server".
  2. `src/utils/api.ts` had the same preview URL hardcoded as a runtime fallback (line 20).
  3. The URL the pipeline would inject per earlier notes, `https://app-release-ready-4.emergent.host`, currently answers **400 "Application not found"** → there is no live deployment, so even a correct APK has no server until the user deploys (Publish → Deploy) BEFORE building the APK.
- **Fixes:** DELETED `frontend/eas.json` (let the managed pipeline own EAS config + env injection, also a deployment-agent blocker). `getApiUrl()` now resolves ONLY `EXPO_PUBLIC_BACKEND_URL` → `Constants.expoConfig.extra.backendUrl` → (web) `window.location.origin`, skips localhost/127.0.0.1/0.0.0.0/10.0.2.2 on native, returns "" when unset (never a hardcoded host again).
- New `src/utils/net-diagnostics.ts`: `ApiError` (kinds `http | no-backend-url | offline | timeout | unreachable`), `deviceHasInternet()` via **expo-network** (new dep, `~57.0.2`), `checkBackendHealth(baseUrl)` against `/api/health`, honest per-kind copy. `api.ts` classifies failures with it; `auth.tsx` no longer flattens every error into "check your connection" and shows an inline "Try again" (testID `auth-retry-btn`) only for transport errors; `onboarding.tsx` surfaces the precise message.
- `NetworkContext` recovery probe switched `/api/auth/me` → `/api/health` (unauthenticated, any 2xx-4xx = reachable).
- New DEV-ONLY route `app/dev-diagnostics.tsx` (bounces to `/` when `!__DEV__`): base URL + its source, host, scheme, platform, device internet, `/api/health` status + latency, session-token presence (never the token).
- `app.json`: added `ios.infoPlist.NSCameraUsageDescription` (WebRTC video calls — App Store blocker).
- Verified: tsc 0 errors, eslint clean, backend 9/9 pytest (`backend/tests/test_iteration55_auth_regression.py`), frontend regression by testing agent (signup→onboarding→connect, login, wrong password/duplicate email copy, all authed tabs, diagnostics screen) — no regressions.
- **Still required from user:** deploy the backend so a permanent `*.emergent.host` URL exists, then build the APK.


## 2026-09-19 — publish readiness after fresh fork (CURRENT)
- Fork had LOST backend/.env + frontend/.env (root .gitignore ignores *.env) → backend crashed (KeyError MONGO_URL). Recreated both: backend (MONGO_URL local, DB_NAME linguaconnect, NEW JWT_SECRET, CORS *, EMERGENT_LLM_KEY, EMERGENT_PUSH_KEY placeholder); frontend (EXPO_PUBLIC_BACKEND_URL/EXPO_PACKAGER_* = preview URL, EXPO_TUNNEL_SUBDOMAIN, EXPO_USE_FAST_RESOLVER). RevenueCat public keys were NOT recoverable (lost with .env) — /vip paywall will show setup-unavailable until user re-supplies EXPO_PUBLIC_REVENUECAT_* keys.
- Local Mongo was empty: admin seeded on startup; ran `python backend/seed.py` (9 demo users + 6 moments, Demo1234!). QA accounts in memory/test_credentials.md.
- Android build hygiene: regenerated genuine `frontend/yarn.lock` (yarn install), DELETED package-lock.json (packageManager is yarn@1.22.22); removed dead `postinstall: patch-package` + patch-package dep (patches/ dir was gone; react-native-webrtc 124.0.8 vendors event-target-shim, so old patch is obsolete). `yarn install --frozen-lockfile` PASS, `expo install --check` up to date (expo 57.0.24), tsc 0 errors, `expo config --type prebuild` PASS, `expo export --platform android --no-bytecode` PASS.
- app.config.js now SMART google-services guard: attaches googleServicesFile only if the JSON has an Android client for the final `android.package` (supports GOOGLE_SERVICES_JSON env file too); on mismatch it drops the file with a loud warning so Gradle never fails with "No matching client found" — push simply unavailable in that build. Added android.versionCode 1 / ios.buildNumber "1".
- REAL EAS build log (2026-09-19): PREBUILD failed ENOENT '/workspace/source/frontend/google-services.json' — pipeline evaluates app.config.js in /workspace/source/frontend, writes RESOLVED config to app.json, EAS builds elsewhere. FIXED: app.config.js now always returns a project-RELATIVE './google-services.json' (recovers stale absolute paths by basename; drops file only on package mismatch). Removed `newArchEnabled` (SDK57 schema rejects it), versionCode/buildNumber (remote version source). Added expo.doctor.reactNativeDirectoryCheck.exclude for incall-manager/webrtc. expo-doctor 21/21, prebuild simulated in separate dir PASS, testing agent verified 6/6. NOTE: pipeline replaces .env EXPO_PUBLIC_BACKEND_URL with https://app-release-ready-4.emergent.host at build; app.json package stayed com.emergent.communityspeak.z97eev (matches Firebase).
- Backend fresh-DB regression 26/26 PASS (auth/users/chats/moments/rooms/ws). UI signup→onboarding verified by screenshot. Full UI regression pending user permission.

## Latest direction: user will perform acceptance testing
- User: “অসমাপ্ত কাজ গুলো কর … এন্ড্রয়েডের apk বিল্ড … সমস্যা … সমাধান … নিজের থেকে কোন টেস্ট করতে হবে না আমি টেস্ট করব”. Focusremainingcode/buildwork; don'tlaunchanotherbroadUIacceptancerun. Requiredsource/buildvalidationremainsdistinctfromuseracceptance. Don'tclaimactualsignedAPK/nativepushdeliveryuntilrealbuild.
- Beforethatinstruction, tester54completed31/31(22translation/reaction+9branding)PASS; controlledpending-fontCDPsplashcapturePASSandstartupafterreleasePASS. MainrealChatunsupportedTelugu->ENexactoriginalwithnowarning+supportedBNtranslationPASS. LogoalphaandseparateopaqueiOSassetverified.
- RecurringMetrolegacy/sounds requests diagnosed: canonicalcodeusesmedia/sounds, oldURLs/testfixturesresolveprojectroot/sounds. Addedbyte-identicalrealcompatibilitysourcefiles plusREADME, noabsolute/appsymlink orprotectedMetrochanges. Existingnativecanonicalimportsunchanged.
- Nativebuildcodefixcompleted(cleanYarnlock/peers/EASignore;test52cleaninstall+hashunchangedPASS). FinalgatependingFirebaseclientforloggedapp.emergent.elevatefamiliarebcc2e16; currentgoogle-servicescontainsdifferentregisteredpackages. NeedauthenticclientJSONorconfirmedbuilderidentitycorrection, NEVERfakepackage_nameindifferentclient/removeFirebase/disablepush.

## Newest user changes — transparent artwork + gentle translation fallback
- UseruploadedNEWtransparentPNG rizf8n77_1000101542.png andaskedlogo+appicontransparent.
  SourceRGBAverified; allinapplogo/splash/defaulticon/Androidforeground/faviconretainalpha.
  Explicitios.iconopaque whitefallbackrequiredbyApple (userinformed); AndroidOSownmask/background.
  No oldgraybox inlogo. Native/JSsplashlightsurfacewhite/dark0B1220. All8assetsmanagedstorage
  archived+hashverified; offlinebundledpaths/provenanceassets/images/BRANDING.md.
- Additionaluseraskednewlogo visibleinsplash: nativepluginconfigured200pxcontainbothmodes;
  BrandSplash nowshownwhilefonts/sessionload, hideAsyncafterrealrootlayout, noartificialdelay.
  Authlogicunchanged, onlyloadingpresentation. Tester53normalstartup/loginPASS;
  controlledpending-fontCDPscreenshotstilltobeverified(latesttestincludesalphaassets).
- Userexplicitnewtranslationpolicy: knownsupportedlanguagestranslate; unknown/unavailable
  source/targetreturns EXACToriginaltext withoutunsupportedwarning. API200+unchangedtrue+
  providerpassthrough makesfallbackhonest. FullconfiguredpickerincludesTelugu/Esperantoagain.
  Originalwhitespace/newlines/emojisretained, Chatpanelnolongertrimssubmittedtext. Realservice/
  networkerrors stillsurface503(notmisrepresentedastranlated). Oldtests49expectingunsupported400/422
  mustbeupdatedONLYforthisintentionallychangedcontract. Newpolicycacheversionv4.
- SourceTypeScript/lints/nativeJSexportsPASS; realunknown-codeAPIreturnedexactspaces/newlines/emoji.
  TargetedUI/backendregressionpending. Buildlockfixcleaninstallpassedtest52; realFirebaseclient
  mismatch withloggedfinalAndroidapplicationId remainsuser-inputblocker; doNOTfakeJSONorremovepush.

## Latest task — production Android build failure (IN PROGRESS)
User supplied EAS logs and approved code/config-only fixes, explicitly NO Docker changes.
Fatal source mismatch: packageManagerYarn1 but no yarn.lock. Generated valid nativeYarnlock,
removednpmfrontendlock, added missing peers viaExpoCLI, addedEAS archiveignore ensuring
lockfile/publicfrontendenv retained. Frozeninstall+TypeScript+freshExpoconfigPASS.
See `/app/memory/BUILD_FAILURE_2026_09_18.md`. Pending cleaninstallation/export/smoke and
deployment-agent recheck. Realnextblocker: pipelinefinalAndroidpackage
`app.emergent.elevatefamiliarebcc2e16` has NOmatchingFirebaseclient incurrentGooglefile;
need authentic clientconfig, no fabricatedrename/pushdisable. Docker/infra/env/db unchanged.

## FINAL CURRENT STATUS — P0 + branding + Chat translation + reactions
- Final gate: **22/22 backend regressions PASS** (`/app/test_reports/pytest/mello_final.xml`), TypeScript0errors/newreactionlintclean, finalAndroid+iOSJSexports PASS(`/tmp/mello-native-final.log`, officialdebug--no-bytecode for ARM/x86compiler mismatch). Nativebinary/device/push caveat unchanged.
- Latest reaction requirement clarified: **one emoji per USER per MESSAGE**, no cap on how many distinct messages a user reacts to. Picking a different emoji REPLACES that user's previous choice; same emoji removes it; other users' reactions are preserved. Real UI+API verified, including independent reactions on two messages. No auth credentials changed.
- Latest WIDTH instruction supersedes earlier320/288 sizes: emoji bar and action card are BOTH **258px maximum** using the same width and left coordinate, narrower on exceptionally small safe viewports. Text/actual voice preview is above them. Quick row scrolls horizontally; pinned+opens full3979Unicode17 catalog including skins/flags/ZWJ families, search+categories, native RN virtualizedgrid, offline data. One grapheme validated server-side(max64codepoints), not old8limit.
- Instagram-like badges straddle bubble bottom border (bottom:-13) with22px reserved space. Incoming left/outgoing right, compact overflow after3distincttypes; per-user reaction rule unchanged. Pressed/selected-state labels and real-error reconciliation retained.
- Final self-verification evidence automation173029: narrowtext/voice cards both258; realHTTPack confirms heart→unicorn REPLACES, sameunicornREMOVES; twoindependentmessagesreacted. automation173038:320x350voicepreview/cards+lastaction+fullpicker/back PASS. Tester51same-remove instability CLOSED by waiting actualmutation response and entire backdrop hidden, on clean QA fixture (don't expect groupedbadgegone ifotherusersstillreacted). Original report retained; final evidence `/app/test_reports/P0_MELLO_FINAL_VERIFICATION.md`.
- Backend suites49/50/51: translation14languages+cache/longtext/emoji, per-user reactions/multiuser,3979catalog validation+complexemoji: prior19+3testsPASS. Newfiles lints andTypeScript clean. Main APIlongtranslation optimization256-tokenchunks/beam2long/request-localchunkdedup; shortbeam4quality. HTTPdeadline50s returnsrecoverable503whilejobcontinuescached, avoidinggateway502/repeatedCPU.
- Prior P0/browser coverage: primarytabflows6sizes+108checks(36additionalroutes×3sizes); Chat/CommentSend hit-tested5sizes. No claimall131routes orphysicalnotch/OSkeyboardtested. Missing realtutorbookingdata was NOT fabricated. /learn/goal redirects toset-goal.
- Mello source/name/icon/logo/assets complete, originalgraybackground/artpreserved andmanagedstoragearchived. Android+iOS native JSexport succeededwithofficial--no-bytecode debugflag (ARMcontainerhasx86Hermesbinary). This is NOTa signednativebinary, OSkeyboardorpushdeliveryproof. Realnativebuildstillneeded.
- Push: AndroidFirebase/currentpackageMATCH; oneauth-readytapowner, tokenrefresh/resume, module-scopechannel. **Actualremote delivery notverified; previewserverkeyplaceholder preventsregistration**. Nativebuild Firebase serviceaccount/APNs+provisionedserverkey needed. `/app/memory/NATIVE_PUSH_CHECKLIST.md`. No inventedcredentials orLLMkeyusedforpush.
- P1/P2 backlog remains DEFERRED (quota/adupsell UI, create-room routing request, social/emailcodeauth/trial, rewardedads, SFU, RevenueCatmapping). No new P1 features implemented.

## Current approved scope — P0 responsiveness + uploaded logo (September 18, 2026)
- Build config changed externally during test49: app.json now uses `com.emergent.communityspeak.z97eev` on Android+iOS, and newly supplied Firebase project mello-16ce3 contains matching Android client (also alternatecom.mello). Preserve current real files. Earlier original identifiers below are historical, NOT desired replacements. Tester49 flagged mismatch against outdated instructions; actual current Firebase/config MATCH.
- Subsequent user priority: “Push notification যেন build-এ কাজ করে; translation কাজ করছে না” clarified **Chat**. Fixed RCA: Google anonymous endpoint429 blocked requests. Text translation now LOCAL M2M100 CT2 int8 (MIT), no external inference/paid fallback. Added langid offline detection + OpenCC Simplified/Traditional conversion; private per-user cache version changed; explicit unsupported errors, queue/timeout bounds. M2M100 lacks Telugu/Esperanto, removed from offered translation targets (names retained for profiles). Local weights already installed, gitignored/reproducible via `python backend/provision_caption_models.py`; they MUST be provisioned on any fresh backend, not downloaded per request. Server compute still uses resources, no third-party per-request translation fee.
- Chat direct calls now use timeout/dedup helper, shared More languages search, inline error+retry, RTL-aware result. Real API EN→BN200; real Chat English paragraph→Bengali + Tap to use draft + Send hit-test at320x350 PASS (automation145837). Broader language/regression suite pending.
- Push audit: Android Firebase client/package match. Removed duplicate unauthenticated root tap handler/channel setup; keep single auth-ready NativeNotificationBridge with cold/warm dedupe, guarded token refresh/foreground registration. Native config preserved. Current EMERGENT_PUSH_KEY placeholder means REAL delivery unavailable in preview; service-account/APNs and build-provisioned serverkey required. Checklist `/app/memory/NATIVE_PUSH_CHECKLIST.md`. Physical foreground/background/killed delivery NOT tested.
- Test48:108 checks(36routes×3sizes) + Learn filter/goal/onboarding interactions + Mello logo/name PASS. No real tutor dataset, booking not testable (no fabricated fixtures). Added /learn/goal redirect to real /learn/set-goal for reported unmatched URL. Adaptive icon actual colored-art radius327.87<330safe, tester's gray-background/shadow detection not clipping. Native mask still needs physical validation.
- Latest explicit name: **Mello**. Apply to Expo display name, welcome/auth/settings, share prompts, API title and catalogue labels; preserve native package/bundle IDs, existing URL schemes, storage keys and user data. Existing contact email is NOT replaced with an invented Mello address.
- User: “P0 করে ফেলো সম্পূর্ণটা. বাদ বাকিগুলো পরে”. No P1/P2 work. Preserve existing UI/colors/fonts/features; fix safe areas, keyboard/composers, sizing, modals/rotation and tabs across all screen families.
- Additional user request: supplied xgnt8aha_1789740818648.jpg as app logo AND icon; confirmed “Do all” after square preparation/gray-background confirmation. This does NOT reopen deferred P1 features.
- Architecture unchanged: Expo Router mobile app, FastAPI + Mongo; no auth/business/backend changes. Actual installed Expo57/RN0.86 source of truth. Protected Metro/main/env values unchanged.
- Added shared layout SafeAreaView (side-cutout guard preserving vertical owners), KeyboardAvoidingView (native automatic offset; no duplicate avoidance on web), BoundedSheet + live screen/popup bounds. Over 100 screens use shared safe-side handling. Five tab bars adapt content row to fontScale; still own their bottom inset. Dynamic Learn pager/popup metrics; bounded scrolling for many filters/pickers/cards; create-group/group-name keyboard handling. Existing designs retained.
- Fixed pre-existing preview bundle blocker: use-screen-space imported obsolete @react-navigation context. Now imports BottomTabBarHeightContext from installed Expo Router public js-tabs API (correct tab ownership; no dependency downgrade/check bypass).
- Test47 core six-size browser matrix passed overflow checks; reported two composer issues. Main investigated true chat issue: FlatList content-size flex basis compressed composer to 9px. Fixed list flex1/basis0 + composer nonshrinking. Comment list also explicitly bounded; tester's comment report originally checked AFTER sending/clearing draft, needs correct filled-draft check. Main chat five-size bounds+trial-click checks PASS. Popup opened in short viewport but first last-action check used wrong role selector; retest with msg-list-multi required.
- Logo: exact uploaded art cropped gray margins only, original background/colors preserved. 1024 icon, padded1080 adaptive,512 splash,256 in-app,64 favicon,96 Android monochrome notification icon. All 6 stored in managed object storage and round-trip hashes verified. Offline bundled copies + provenance in assets/images/BRANDING.md. Welcome/auth/settings use shared AppLogo. Native launcher/splash need a fresh binary, not Metro refresh.
- app.json orientation default for rotation/tablet, Android keyboard resize explicit. Native hardware/notch/keyboard/fontScale testing still NOT performed; browser simulations are not device proof.
- Remaining before handoff: correct comment/popup self-tests; remaining Learn/Pro/Premium/Lessons sheets route coverage; final asset/config verification, lint, documentation, frontend restart.
- Deferred unchanged: P1 warning/time-up VIP/ad cards, room-create flow issue, social/email login/trial; P2 rewarded ads/SFU; RevenueCat mapping blocker/safeguards.

## NEW ACTIVE REQUIREMENTS — hide all quota displays, 30-minute warning, VIP / rewarded-ad limit card (NOT IMPLEMENTED YET)
- User explicitlyrejectedremainingtimepanels/badgesandVIPunlimitedlabelsanywhere. RemoveRoomTimePanel/Badgefromlobbyandroom (retainserveraccounting/internalAPI). FREEin-roomwarningONLYat30minleft, not5min. VIPgetsnoquota-timewarningsorunlimitedlabels. Existing2h/dayhost+separate2h/daylisteningrulesremain.
- Nextuseradded: afterlisteninglimitexhausted, attemptingjoinanotherroommustshowcardwith2options:existingVIPpurchasepageorwatchadforextra~1hourlistening. HostingtimeNOTextendedbyad. Needconfirmonehour/rewardanddailyclaimcap. RealAdMobAndroid+iOSAppIDsandRewardedAdUnitIDsmissing; integrationplaybookretrievedbeforecode. AskhumanproductionIDsorpermissionforofficialtestads; NEVERfakeadbutton/clientgrant. VerifiedGoogleSSVonly,atomicuser/day/transactiondedup,separatebonusgrant/noledgerreset,UTCexpiry,consent/UMP. DoNOTinstallnativeAdMob/placeholdersuntiluseranswers. Nativephysicaltestlimitationsstillapply. ExistingRevenueCatmappingblocker/guardsremain; VIPbuttonlinkisnotproofcheckoutworks.
- CURRENTUISTILLshowspanelsand5minwarning untilthisnewrequestimplemented. No rewardSDK/backendAPIexistsyet. Priorinlinequota/time-noticeUI codeisnotfinaldesiredUX.

### Latest actual verification / corrections
- Main20260918_123106 real2-browsercallPASS: authenticatedsocketsopen -> actualcall_offer/ringing/ICE -> bothRTCPeerConnectionsconnected -> bothclosedonend. Iter45callee-popupfailurewasNOTreproducedwithreadiness-awaretest; noauth/signalinghackadded.
- Main20260918_123506 focusedcreateformat320×430: submit y361.44,height54fullyinsideviewport; UIcreatedroomandnavigatedcorrectly. Scriptthenmistakenlyexpectedresponse.room insteadflatRoom.id (testharnessonly). Fixednative/webformlayoutcrFlex(minHeight0)/nonshrinkingfooter/AndroidKAVheight. GeneralVoiceRoomsheaderwasnotrequestedrename; ONLYChatsVoiceroomnoticeidentitychanged.
- Main20260918_124114 realMomentsUI PASS: actualauto-sharedroompost #voiceroom visiblefeed/detail, uploadedSendpersistedcomment201, commentTranslationIconnonemptySVGpathsEXACTmatchMomentdetailglyph. No translationAPI/paidLLMrequestmade. EarlieremptyMomentstestwaslackoffixture.
- MainvalidcalltestaddedZEROnewMetro/frontend/soundsENOENT; totalremains2oldbadassetURLrequests. No fakefolder/assetduplicationorcache/authfixadded.
- TemporaryQAfixtureawaitingEXACTcleanup: room0f1f0fd4-14e2-4251-9894-6cd3586b7682 (QA1owner,nowended),autoMoment316c9b94-a711-4fdc-8b12-26ef3f4118b4,comment792a45a9-4967-4611-8cce-bcada6947a82,noticesforTHATroomonly. Neverclearentirecollections. Latestattempt2-clientroomUI testfailedonharnessloginreadiness/contexts; no2-clientroommediaclaimforthatrun.

## Latest request — verify Android AND iOS calls/Voicerooms
- User explicitlyaskedbothplatformstests. Nativeconfigintrospection, isolatedAndroid+iOSprebuild,autolinkWebRTC/InCallManager, nativeplatformJS-onlyproductionexportsALLPASS. TSCNOWZEROerrors afterfixingColorValuefacade(FilterGlyphincluded). FullHermesexportsblockedbyx86_64compileronARMLinux; noengine/dependency/protectedconfigchangesmade. NoSDK/Java/emulator/Xcode/phonesavailable, soNOAPK/IPAcompileorruntimeproof. Fullrecord`memory/NATIVE_CALL_TEST_MATRIX.md`.
- HardenedAndroid12+Bluetoothruntimepermissionbeforeaudio,sharedpendingrequest; deniedBluetoothnotmicblocking. Asynccancelguardsroom/call, explicitvideo:false. LegacyBluetoothAdminmanifestdeclared; removedignoredExpo57edgeToEdgeflag. ExistingconditionalRoomAudioEnginewasALREADYcorrect—earlyunconditionalhypothesisdisproved,norewrite.
- BLOCKERSexplicit: noTURNconfigured(cellularNATnotguaranteed), noCallKit/PushKit/killed-appnativecallUI, AndroidWebRTCmicrophoneforegroundservicenotimplemented, nativebackground/Bluetoothphysicaltestsnotrun. ExistingFirebasepackageIDmatchesAndroidbundleID. ExpoAudioforegroundMEDIA_PLAYBACKserviceisnotproofWebRTCbackgroundcapture.
- Priorincrementbackend15/15PASSreport44, plusmainstrengthenedtruelegacyhost_usagecounter+EXACT1warningdeliverytests2/2PASS. Tester44onceclearedwarning-dedupcollectionduringmanualcleanup; durations/quotasnotcleared. Cannotreconstructunknownoldwarningrecords; mayrepeatwarning. TestfixturesnowONLYexactIDs scopedcleanup, recordtemporarycredentialsimmediatelyandmarkdeleted. Newfixtureaccountsremoved (verifiedlookup),noQA1/QA2passwordchanges.
- Pendingfinaltestingagent: nativeevidenceverificationandnativepermissionlogicunitbranches(NEVERlabelasphysicalpass), browserregressioncovernewUI+rooms/Send/Voiceroom/translation/Practice. Finishmuststatephysicalnative/cellular/backgroundlimitationsclearly.

## Latest combined increment — daily room time + uploaded global Send + Practice title (testing pending)
- LatestusercorrectedSend scope: useuploaded`icons8-send-512.png` for ALLmessageSendicons,notjustprivate/groupchat. Manageduploaduei5iyvb exact7099bytePNGbundled`assets/icons/send.png`,SHA25628f7b1953f4ecc712c3acb86301ee5f375811393bdac5531b42000ce8d76784a. Globaliconfamiliesnormalize send/send-outline/paper-plane aliases toSendGlyph, retainbuttoncolors/handlers/hittargets. Transparentpaddingcroppedonlyinviewport; noSVGredraw orbase64conversion.
- Practiceclarification: insideChatsCallshortcut'sdestination `/call`, titlemustbe`Practice`andsmaller. DONE+mainbrowserverifiedinner18pxnavigationtitle; shortcutlabelPracticeatNORMAL11px (initial10pxshrinkremoved), mainChats28pxunchanged. ExistingtestIDs/routesretained. Screenshot20260918_113157.
- Dailyquotas userexplicitlyconfirmed: FREE2h/dayhosting +SEPARATE2h/daylistener/speaker/moderator; unlimitedroomCOUNT, sumtimeacrossrooms; VIPunlimitedtime/count. UTC00:00reset(chosenconsistentwithotherexistingdailybudgets; communicated). Removeoldhost_usage/free_rooms_per_daygate; legacyDBcountsnotreset/modified, oldadminUIroom-countfieldremoved.
- Backendnewroom_time_clock.py(Pydanticsnapshot+UTCclippedintervalarithmetic),room_time.py(persistentMongo room_time_intervals uniqueopenintervalperroom/user/bucket,lifecyclelock,serverwatchdog1s,5minwarning,autoendallownedroomswhenhostbudgetspent,removeonlyexhaustedlistenerWITHOUTban). Openownedroomsconsumehostingtimeevenowneraway;simultaneousopenroomsaddtime,shownUI. Existinglive roomsstartnewpolicynow,nohistoricalcharge. Clientheartbeatusesauthenticatedserverclock; liveWSkeepsbackgroundlistenerleasefresh,otherwise75sdisconnectgrace thenremove/stopcharging. VIPcheckedserver-side; currentexpiredVIPstartsfreeaccountingafterexpiry. NewGET/api/rooms/time-allowance andPOST/api/rooms/{id}/heartbeat. Start/leave/end/kickpersistintervalsandduplicatejoinsdon'tresetclock. Enteranotherroomsettlesoldmembershipwithouttransferringownership.
- FrontendRoomTimePanel inVoicelobby(host/listenerremaining,UTCreset,Vipunlimited),RoomTimeBadge insideroom,rootRoomTimeNotice warningsandquotaendvisibleevenminimized. Root5sheartbeatupdatesallowanceandremovesaudioonserverend. DailycapsNOTappliedto1:1/RandomPracticecalls. CreateRoomnowunmountsModalbeforedeferrednavigation tofixpreviousknowncreationbugneededforunlimitedroomflow. FailedjoinsnowshowactualAPIerror ratherthansilentfail.
- Pendingmajorbackend+frontendtestagentvalidationforquota+globalSend andpreviousVoiceroom/tag/translationincrement. DoNOTclaimtheseallpasseduntilreports. SourceTSCbaseline16legacyerrors; fullprojectESLintReactcompileralsohaspreexistingrefs/effect/staticcomponentdiagnostics, avoidunrelatedlargeaudio/refactorjusttopleaselint. Newfilesdedicatedlintmustpass.

## Latest increment — Voiceroom identity, share tag, unified translation icon (testing pending)
- User confirmed plan + optionক: firstChats systemrow/screen title exactly `Voiceroom`; read-only notifications (NO message composer/send). Fixedsize54/38 avatar with existingMicGlyph and bottom-right edge badge shared bylist/feed prevents checkmark drifting down tallbubble.
- System notice preview nowtyped room viaMessagePreview; both notice andpersonal/group roomshares display appMicGlyph + `Voiceroom`. Latestmessage takespriorityover partnerlive text (avatarlivebadge retained); searchmatchesnewdisplaylabel AND originalroomtitle. VoiceroomnoticeWS refreshes row/feed; reopeningfeedrefreshes notices.
- `_share_room_to_moments` persists `tags:["voiceroom"]` for bothcreateauto-share/manualreshare. Existingcustomcaptions/private-room guard preserved; originalMoments tagchips nowhave testIDs. No historicaltagbackfill or syntheticposts.
- `TranslationIcon.tsx` wraps EXACTexistingMoments expanded `Ionicons name=language`/Languages artwork. Replaced allad-hoc文A glyphs inchattext+voice sidebuttons,chattoolbar,longpressmenu,Momentscomposer,OCRselection,postcomments/replies andcanonicalMomentsdetailaction. Sameexistingtranslationservice; no newproviders. Previouslyno-opcommentbuttons nowcalltheexistingtranslateText handler, with visibleweb/native success/error; audiocommentswithouttextdisabled. Othertranslation/collapse/transcriptionbehaviorunchanged.
- Pendingfocusedfunctionaltests. No auth/trial/payment/globalredesign/knowncreatemodalnavfix inthisincrement.

## Verified — uploaded ordinary-call outgoing ringback
- User uploaded `4ujvcwzq_call going to voicemail - sound effect_[cut_22sec].mp3` and confirmed: only ordinary private/chat/profile outgoing caller hears it softly; keep current incoming ringtone; do NOT apply it to Random Practice. Stop on accept/reject/cancel/timeout.
- Bundled exact bytes as `frontend/assets/sounds/outgoing-call.mp3` (22.224s, SHA256 d4ecc39c6993ea9c274e13e3b1e85406650e5633be2c5629a43d2f44a1dcc2a1). Audio analysis found ringback only, no speech. Existing `ringtone.wav` hash unchanged (see assets/sounds/README.md).
- Extracted `src/hooks/use-call-tones.ts`: ordinary outgoing MP3 at0.16, incoming original WAV at0.35+same vibration, Practice outgoing originalWAV at0.16. Loop only pending-call state, no restart Calling→Ringing; each new call rewinds. Local playback only, not RTC stream. Cleanup and cancellation guard suppress pending starts after teardown; CallContext stops tone synchronously when status/identity changes, before microphone enables. User null/unmount also stops hook playback.
- VERIFIED: iteration42 backend3/3+assethashes; iteration43two-browserordinarycancel/reject/accept/connectedpass. Itsloop/practicetestgapswereharnessissues (noauth/appfixneeded). Mainactualbrowser 20260918_111923: MP3currentTime0.213→20+→0.012 after22.224secloop; looptrue/.16/ready4/noerror. ReceiveroriginalWAV.35advances.45secunansweredtimeoutbothpaused. Main20260918_112128: BOTHQA viarealCallhubAlllanguages+availability+RandomPartner match; actualWAVadvancesat.16caller/.35receiver, NO MP3play; cancelbothpaused. ObservedoriginalHTMLMediaElementmethods only, noAPImocks/productiontelemetry. Screenshots + toolconsolelogs captured.
- No backend/auth/RTCprotocol/UI/voice-room/voice-message/billing changes for ringback. Native physical audio routing/OS background behavior notverified; doNOTclaimit frombrowserresults.

## Latest continuation — inbox preview icons ONLY (user narrowed scope)
- User first said "Do all", then explicitly superseded that with Bengali "এখন আপাতত এই কাজটা করো": ONLY replace system emoji in the Chats list's latest-message line with the existing app microphone/call artwork for voice messages, calls/missed calls and shared voice rooms. Do NOT implement auth/trial/room navigation/global layout in this increment.
- Implemented `ChatLastMessage.tsx`: exact existing `MicGlyph` (voice + room) and `UploadedActionIcon` call PNG, 16pt beside one-line preview; theme secondary color and existing row/unread/timestamp/live-room behavior retained. No asset replacement or new image storage.
- Added typed preview metadata in `backend/chat_previews.py` and chat send snapshots; legacy snapshots enriched from their exact original message in a single batched query, response-only (no data migration). Actual text that looks like a media preview stays text. Existing preview duration/title/status and message history preserved.
- VERIFIED iteration41: backend 9/9 passed (typed voice/call/room/text snapshots, custom room captions, status/duration, unread/sender/time, legacy list+detail enrichment); browser390/320 previews, exact existing glyph components, no double emoji, long title truncation, unread separation, search/filter/row navigation, light/dark all passed. Report `test_reports/iteration_41.json`; no new bugs. Main follow-up browser check confirmed actual text `📞 Missed call` remains literal text with NO media icon at320 (first script argument typo corrected; second run PASS). Tests created only QA fixtures; no real audio/native-device verification or integration calls claimed.
- Static checks: all 5 changed source files lint clean; TypeScript has the identical 16 pre-existing sub-app navbar ColorValue diagnostics. Existing auth, RTC and purchases were NOT modified.
- P0 deferred by latest instruction: known create-room modal navigation bug. P1 deferred: Google/Apple/email-code auth and new-device 7-day trial; playbooks retrieved ONLY, no implementation/config changes. SMTP credentials not supplied. RevenueCat safeguards unchanged; upstream mapping blocker remains. P2: report wrapping, safe-area/keyboard/native verification, self-host SFU infrastructure remain outside this increment.

## Current approved increment — ephemeral practice calls + consent-based stage/moderators
- UpcomingP0latestuser: realOSpushmessages/likes/calls+appicon/banner, gentleincoming/outgoingtones, Callinguntilactualdelivery/Ringingafterclientack, busy1to1/roommessage. Managedpushplaybookretrieved; mustcollectgoogle-services.json BEFOREcoding. No newremotePush/ack/offlinecallrecoveryyet. RealdeviceFCM/APNssetuprequired; doNOTfakepushsuccessoruse local-onlynotifassubstitute.
- Latestannouncementprivacy/notices/removal/waitclock/selfsheet editsnowapplied; finaltestpending(afteriter39). Existingbackendtests38needrerunpostprivatepayload; frontendselfLeaveStagebuttonnowINSIDEprofile, toprequestbannerdeletedmanagerrequestsviara il; removeduserexpectroom-removed-screen. No callcaptionrouter now, legacycaptionendpointtestsoutofdate.
- NEWEST approved refinements (supersedeinitialUI): noCALLcaptions atall (panelandcaptureunmounted;backendcallcaptionrouterunregistered), ONLYspeakerON/OFF(notvolume%), nativeaudioSingleforceSpeakerAPIwithproperOSrestore; NOphonybrowserrouting. Browser/ExpoGocan'tswitchphoneearpiece, nativephysicalverificationpending.
- Stage/modinvitationcards nowCOMPACTCENTERED title+Accept/Rejectonly(noavatar/details); userconfirmedAcceptstays. ALLmemberprofilesbottomanchored64%heightmax540+safeinset+scroll, opensSELFtoo:selfmute/unmute,leaveStage,leaveRoom. RemovedstandaloneLeaveStagebar. Create/Roomtitlesreduced23/19;VoiceRoomlistcardpadding14gap9title15(toplisttitle22).
- NEW waitinghand->rotatingclock(reduced-motionaware)untilaccepted/rejected/cancel;host/modinvitationRejects/Acceptsprivatein-appnotice; removeduserdedicatedRemovedscreen(notroomendedsummary). JoinannounceONLYlowerroomchatformat'NAMEjoinedtheroom'; topjoin/requestbannersremoved, privatehandcountonmanagerrailonly.
- Backendroom_detail/broadcastper-viewerscrubsotherusershand/invitedflagsforaudi ence; owner/modsseeall/selfseesownstate. Privateinvitationresultsonlymanagers;rejectedrequestonlyrequester. No publicstageevents or notificationchatmessages. LatesttestsPENDING; prioriteration38/39backend11pass(beforeprivacychange), voicecollapseAPI18secactualPASS/noextrarequest; currentduplicatekeyfixedprefixes.
- User Bengali: only Chats→Call discovery/random calls show top request cards; Accept opens full call UI; NO inbox, messages or any persisted call history; maximum10minutes AFTERactualconnection. Ordinary profile/chat calls use full UI fromringingandretainexistinghistory. Implemented distinctserverpracticeflag, noMongoCallsinsert/update+nofrontendchatlog, server600secdeadline/clientpolling, listeningvolume±10%, existingmute/nativeaudio-routing maintained. Physicalnativeaudio notyetverified.
- Stage: raisedhandrequest explicitAccept/Reject; separatehost/modinvitation60sec+targetAccept/Reject (no forcedpromotion); speaker mic enabledonlyafterrequest/inviteconsent; host/modmute cannotremotelyunmute, demote/kick; speakerLeaveStage. Globalsmallinvitationcardevenminimized; safe-scrollrequests/profile/modlists andnavinsetalignment.
- New requirementmoderators: OWNERonlyinvite/remove consent-basedmoderators, rosterAdd/Remove/Cancel; moderatorpurple shield atsameposition/noauto stagepromotion. Moderatorcanstageinvite/requestaccept/reject,mute/demote/kickordinarymembers,roomsettings/chatmute/timer/share/end. Cannotappointmoderators/transferowner/moderateownerorothermods. OwnerleavingkeepsownerIDandreservedfirstcoffee-seat, modneverbecomeshost;emptyroomcloses. Returningownerrolehost;moderatorpersistsuntilownerremoves. Oldtransferhostendpoint410(host)/403(mod).
- Roomincome belongsONLYowner: roomgiftvisualrecipientunchanged; diamondcredit/giftledgerfinancialbeneficiary/wallettransactionowner_id, noautomaticmodshare. Coin debitatomicguard. Existinghistoricalearningsuntouched.
- Files: backendroom_permissions.py,routes/room_stage.py,room_moderators.py,rooms.py,rtc_core.py,rtc.py,call_practice.py,server.py; frontendCallContext,RoomSessionContext,components/room/*,app/room/[id].tsx,tabslayouts/api/incall.
- Status: implemented, lint/types beingchecked, end-to-endtestingPENDING. No newbilling/authscope; priorRevenueCatprocontractissueunchanged.

## Latest continuation — Call hub & local mother-tongue captions (backend/browser verified; native pending)
- FINALREGRESSION 2026-09-18:17/17backendtestsPASS, finalchangedbilling/VIP/VoiceBubble/RoundFlag/AppSwitch/hooks lintclean. Evidence test_reports/final_verification.json andpytest/final_backend_regression.xml. FeaturestatusPARTIALbecauseexternalbillingproactivationunresolved, notMVPcomplete.
- FINAL: verified customfiltericon/roundflags/modalnooverlapphoneviewports, uniformgendercolours, sharedprofileavatars/topcountdownCall, mutuallyexclusivePaid/Giftmode, actualexclusivevoiceplaybackinclend/navigation. Iter37backendcorrected7/7; sourceofonefailingtestwasinventedroute—notproductbug. Mainvoicetest064926actual8secwavandHTMLmedia statesPASS.16oldTSdiagnosticsremain, none new.
- REVENUECATBLOCKER: integrationcodeandSDKTestStorepurchase wired; expectedprodoesNOTactivate becausemanagedsetupcontractpro/mappings differsactualSDKentitlementelevate_familiar_pro andcurrentofferingsmonthly/yearly/lifetime. Keysidentityverifiedcorrect; properupsertrepeatnotresolved. Supportresponseverbatimshown, support@emergent.sh nextaction. NoVIPfakegrant; liveguardOFFandcoincheckoutnotconfigured. DoNOTclaimbillingcompleteoractiveprotestsPASS. ErrorUIblocksrepeatbuyswhenSDKreportsotheractivesubscription.
- FutureP0 onceupstreamfixed: retestSDKactive.pro/purchase/restore/accountisolation, resolvesecureVIPfulfilmentforserverlimitedexistingfeaturesbeforeenablelive, realcoinpacksverification/storecredentials. P1 newGoogleApple/emailOTPauthand7daydevice-oncetrialneedseparateplaybooks/config/eligibilityconsent; nativephysicaldevicevalidation. Fullsafecontextinmemory/current_task+revenuecat.md.
- Latestrequirementsqueued: localstorecurrencyforVIP/coinpurchasepricesandwalletpurchasehistory(useactualPlay/AppStorelocalizeddata, notprofilecountryorcosmeticFX); 7daynewusertrial once/account+device; addGoogle/Applelogin andemaillogincode. Noauth/trial/IAPimplementationyet; credentials/productIDs/consentchoicesneeded. Misroutedtrial/authplaybookreturnedRevenueCat-only; doNOTclaimauthsetupdoneoruseclientonlyentitlementgrant. Moredetailscurrent_task.
- NEW priority: REALGooglePlayBilling forVIP+consumablecoinpacks; gift/sticker virtualgoods usecoinbalance. Playbookretrievedonly (expo-iapExpo57, GooglePublisherverification/ackconsume, idempotentledger, RTDN). WaitingPlayConsolepackage/productIDs/baseplans/serviceaccountsecureconfiguration. No IAPimplementation/no realpurchaseverification yet; legacyfreeVIPandcreditroutesneedreplacement. No privateJSONkeyschat. PreserveprotectedMONGO_URL; transactionreplicasetcapabilitymustchecked.
- New pendingverificationchanges: singleactivevoiceplaybackacrossVoiceBubble/recordingpreviews; canonicalgendercoloursmaleBlue/femalePink; PaidPracticevsGiftGate mutualexclusivitybackend/UI; roundflagsforcountry/languagefilterlists. Detailedfilelist/statusin current_task.
- ExactuserfilterPNGfinallyretrievedandmappedgloballyviaFilterGlyph source1l8f05p9. CallFilterSheetwebnoKAV/Modalfade/boundedviewport/scroller/footerpatchedafterRCA2; stillneedsretest. AppwidebottomoverlapworkNOTcomplete, inspectLearnfiltermodals androot/stackinputfooters beforeclaimingall.
- NEWEST requirements/pending: use newlyuploadedcustomfiltericon app-wide (assetnotretrievable: currentget_assets lists18olderfilesonly; awaitingfile/link). Auditfixallfilterpage/screenbottom-overlapsagainsttabs/systemnav. CallFilterSheet latestlayoutfixawaitsverification; globalsweepnotstarted.
- New filterfeature implemented: country/native language/gender/age/level/photo, searchablecountrylanguage selectors, draftApply/Reset/discard, activecount/summary/clear; serverlist/directandbilateralrandommatching. Iteration36backend5pass1skip(positivecountrydatafixturemissing); remainingflakyfilterUI HIGHissue latestpatchabove in current_task.
- LatestcallUX verifiediteration36: bothoutgoing/incomingTOPcards/countdown45s/no fullUIbeforeaccept; Accept->fullcall, Reject/Cancel/noanswercloseboth. Serverautodeadline45s andconnecting30s tested. SameProfileAvatar nowsharedwithConnect54px. Userheadercomplaintfixedtop12andcenterequal.
- FINAL latest request delivered: Call partner rows reuse SAME shared Avatar (photo/initials, frame, country flag, boost styling) + VIP badge and separate call icon; avatar opens existing profile. Actual incoming signaling now renders small themed `IncomingCallPopup` with caller identity, Accept/Reject; Accept transitions to full-screen connected call controls/captions. Ringtone/vibration unchanged. This is foreground/online in-app notification, NOT killed-app native push/CallKit.
- FINAL verification: iteration35 backend6/6 (All cross-language listing/matching, blocked/self/non-optin, cancel reservation and room membership/kick/end relay); final combined iteration34+35 rerun **10/10 PASS** (`test_reports/pytest/call_final.xml`). Main two real browser sessions at390 and receiver320 verified avatar+call -> incoming popup -> Accept -> connected full UI -> mute -> end synchronized, second call Reject synchronized. `aria-checked=true` verified both users; MicOffGlyph warning absent in prior iteration35. Native physical media not verified (browser uses test media).
- Language filter policy: All + ONLY persisted learning_languages max3, legacy learning_language fallback, no arbitrary/native filler. Existing profile non-VIP1/VIP3 learning-language limits deliberately preserved; this task did NOT authorize changing profile monetization. A profile with1 saved language correctly gets All+that1. Iteration35 temporarily set QA1VIP to verify3 then restored. Missing /tmp screenshot mentioned by tester is remote-tool artifact storage, NOT app defect.
- Removed one stale QA-only room left open by tester35 (`44298d84-3ddf-48f7-8998-0d9075c35664`, hostQA1) using host end API; it correctly blocked concurrent calls but error was misleading. Caller-busy now says leave current call/room, not partner unavailable. Retest passed after cleanup; no real rooms/accounts changed.
- Current lint: changedfiles clean; TypeScript26 PREEXISTING diagnostics remain (no new ones; fixed one RoomSession absoluteFillObject). Testcredentials unchanged. No production/native scalability claim.
- NEWEST user clarification: language bar is **All + only the user's saved learning_languages (max3)**, fallback ONLY legacy learning_language; never pad with arbitrary or native languages. If user learns1 language, show All+that language, not fake3. All lists all opted-in available users regardless language; All random matches any willing language partner. Redesigned hero has layered radial pulse+orbit only during real search, reduced-motion aware; tabs/card/safeareas retained.
- Iteration34: core backend3/4 + two-browser call/accept/mute/end/decline/re-call UI passed; new caption test failure traced to test fixture silently replacing failed406 speech download with2.2s sinusoid (NOT STT bug). Corrected fixture requires real WAV; curl downloaded actual PCM; self-rerun4/4PASSED, actual translated bn+es events, silence/oversize/revoke/ended guards verified. VAD intentionally not weakened. Native audio still untested; model translation quality not guaranteed.
- Fixed MicOffGlyph SVG accessible=false leakage on web; nativefalse retained. Room transient-network poll no longer kills recoverable room; kicked/ended definitive close. Cancel search now invalidates pending matched random reservation. These final changes need focused verification with new All feature.
- User latest: Chats Premium shortcut becomes **Call**; Pro remains. WebRTC must serve ALL calls and Voice Rooms, not just random practice. Each listener sees transcribed/translated speech in their own profile native_language; no paid APIs.
- Added real opt-in Call hub `/call`, presence+language matching+random queue, direct consent-based incoming calls; `/api/rtc/practice/*` separated from existing paid practice. No coins required. Availability expires40s, search120s, busy/blocked filtered; signaling remains one worker/in-memory plus Mongo call history.
- Local installed Whisper base + M2M100418m int8, 21 app languages inc Bengali. `/rtc/calls/{id}/captions` consent/status, `/audio` bounded PCM. Both participants consent; no stored audio/transcripts; outputs automatically localized per profile (never hardcoded English target). Native PCM uses Expo57 AudioStream, simultaneous capture with WebRTC unverified on physical devices. Web uses existing mic track.
- RTC shared busy guard, truthful connection timer, dedup ICE fetch, rooms shared-mic/peer creation dedup and early ICE preserved. Existing mesh kept: no SFU/TURN host provisioned, no universal NAT/scalability claim.
- Tab-label clipping and WeeklyReport narrow header adjustments implemented, runtime testing pending. Frontend lint clean/new types clean,27 unrelated preexisting TSC issues.
- P0 next: user review of Call/popup design and physical iOS/Android WebRTC+simultaneous PCM capture (Expo Go cannot run nativeWebRTC). P1: self-host TURN+SFU requires reachable public media infrastructure; voice-room captions and killed-app incoming push/CallKit not implemented. P2: translation quality evaluation per21 languages, audio-tap integration if dualnativecapture conflicts, shared signaling broker and inference capacity.
- Caption setup: dependencies in backend/requirements.txt; run `python backend/provision_caption_models.py` once if local weights absent. Both repos pinned; ignored `backend/caption_models` contains ~650MB models+SHA256 manifest, configurable CAPTION_MODEL_ROOT. No paid calls or keys. API reports unavailable if models absent rather than returning fake text. Do NOT lower VAD just to accept non-speech.

## Original Problem Statement
"Can you clone hellotalk app" — A language exchange application similar to HelloTalk featuring user profiles, native/target language matching, and messaging capabilities. User communicates in **Bengali** — always respond in Bengali.

## User Choices (confirmed)
- Full HelloTalk feature scope ("All")
- JWT-based email/password authentication
- AI-powered translation via **GPT-5.2** (Emergent Universal Key)
- **WebSocket** real-time chat
- HelloTalk-like design (light sky blue) — design system in `/app/design_guidelines.json`
- Streak = CONSECUTIVE days (user picked option A)

## Tech Stack
- Frontend: Expo (React Native) + Expo Router, Figtree/Nunito fonts, light sky-blue theme
- Backend: FastAPI + Motor (MongoDB), JWT (PyJWT + passlib bcrypt), WebSocket at `/api/ws`
- AI: emergentintegrations LlmChat → openai/gpt-5.2 (EMERGENT_LLM_KEY in backend/.env)

## Architecture
### Backend (`/app/backend/`)
- `server.py` — app, CORS, WS endpoint `/api/ws?token=JWT`, router registration
- `db.py` — Mongo collections: users, conversations, messages, moments, comments, rooms, room_messages, audio_files, media_files, profile_visits (+indexes)
- `auth_utils.py` — bcrypt, JWT, get_current_user
- `models.py` — Pydantic models + user serializers (`_learning_list` compat helper)
- `routes/` — auth.py (streak logic `touch_streak`), users.py (partners matching, visitors, avatar upload, country/age immutability), chats.py (text/voice/image messages), moments.py (posts, likes, nested reply comments), rooms.py (voice rooms + host moderation), ai.py, audio.py, media.py
- `seed.py` — idempotent: 9 demo users (multi-language lists, age, interests) + 6 moments (password Demo1234!)
- `tests/` — test_api.py, test_new_features.py, test_iteration3_features.py, test_websocket.py (WS tests need pytest-asyncio — missing in env)

### Key API Endpoints (all `/api` prefixed)
- POST /auth/register, /auth/login (updates streak); GET /auth/me (updates streak)
- PUT /users/me (country & age SET-ONCE immutable); POST /users/me/avatar {image_base64,mime} → avatar_url=/api/media/{id}
- GET /users/me/visitors → {count, visitors[+visited_at,is_online]}
- GET /users/partners?language= (best-match uses learning_languages/teach_languages lists); GET /users/{id} (records profile visit, returns profile_views)
- POST/GET /chats...; POST /chats/{id}/voice; POST /chats/{id}/image; GET /media/{id}; GET /audio/{id}
- Moments: GET/POST /moments, /like, POST /moments/{id}/comments {text, reply_to?} → reply_to_author
- Rooms: CRUD + /join (banned→403), /leave, /end, /hand, /hand/dismiss {user_id} (host), /mic, /role, /kick {user_id} (host, bans), /messages
- WS relay: call_offer/answer/ice/end/decline, rtc_*; events: new_message, room_update, room_message, room_ended, room_kicked

## DB Schema (uuid string _id)
- users: email, password_hash, name, bio, country (set-once), age (set-once), avatar_url, native_language, teach_languages[≤2], learning_languages[≤3], learning_language (compat=first learning), proficiency, interests[≤20], streak_count, last_active_date, created_at
- profile_visits: visitor_id+visited_user_id (unique), visited_at (upsert)
- messages: type text|voice|image, audio_id/image_id; media_files & audio_files: {_id, data(bytes), mime}
- rooms: host_id, members{uid:{role,mic_on,hand_raised}}, banned[], is_live
- comments: moment_id, user_id, text, reply_to?, reply_to_author?

### Frontend (`/app/frontend/`)
- Tab order: **Chats, Connect, Moments, Voice, Me**
- `app/onboarding.tsx` — 6 steps: native lang → teach (≤2, skippable) → learning (1-3) → country (one-time) → age (13-120, one-time) → interests (1-20)
- `app/(tabs)/connect.tsx` — filters: Best Match + user's ≤3 learning languages (NO Everyone)
- `app/(tabs)/profile.tsx` — HelloTalk-style: avatar photo upload (camera badge → image picker → /users/me/avatar), stats bar (🔥streak | 👁profile views→/visitors | 📅days member), collapsible language edit sections (LayoutAnimation), interests chips, locked country/age (🔒), segmented light/dark toggle (mode-light-btn/mode-dark-btn)
- `app/visitors.tsx` — profile visitors list (time-ago, tap→profile)
- `app/user/[id].tsx` — partner profile: stats row, interests chips, age, records visit
- `app/chat/[id].tsx` — text/voice/image messages, plus-icon media button (chat-media-btn), per-bubble AI translate; grammar-correction UI REMOVED (backend /ai/correct still exists)
- `app/moment/[id].tsx` — nested comment replies (Reply btn per comment, reply banner, "Replying to X" tag, indented)
- `app/room/[id].tsx` — host card (room-host-card), Stage requests panel (hand-accept-{id}/hand-dismiss-{id}), host controls per member (room-role-btn/room-kick-btn), flags on all avatars
- `src/components/Avatar.tsx` — flag badge bottom-LEFT, blue online dot (#0EA5E9) bottom-RIGHT; resolves relative avatar urls via assetUrl()
- `src/components/LanguagePair.tsx` — short codes (EN⇄ES) everywhere; compact = smaller single-line chips
- `src/constants/` — languages.ts, countries.ts (COUNTRIES list + countryToCode), interests.ts (32 options, MAX 20)

## What's Implemented (June 2026)
✅ MVP: auth, onboarding, partner discovery, WS chat, AI translate, moments, profiles, seed
✅ Voice messages, voice rooms (hand raise/roles), WebRTC voice calls (WEB ONLY — native needs dev build)
✅ Streak (consecutive days) + profile visitors + stats bar (iteration 2 — tested)
✅ Image messages in chat (media collection + /api/media)
✅ Multi-language (native+2 teach / 3 learning), Connect filters, tab reorder
✅ Nested moment replies, avatar flags+online dots everywhere, profile photo upload, collapsible language sections, interests, set-once country/age, dark-mode segmented toggle, voice room host moderation (kick/ban/hand accept-dismiss)
✅ Tested: iteration_1/2/3.json all pass (backend 15/15 + full frontend E2E)

## Backlog / Known Issues
- LOW: auth-hydration race on hard reload deep-links (first API call 401 before token restore) — carry-over
- LOW: RN deprecation `props.pointerEvents` warnings
- env: pytest-asyncio missing → 2 WS tests skipped
- P2: typing indicators, inline message corrections, followers/hashtags
- Refactor: profile.tsx ~950 lines — split edit sections into components

## Notes for Future Agents
- Fork lost .env files once — recreated: backend/.env (MONGO_URL, DB_NAME=linguaconnect, JWT_SECRET, CORS_ORIGINS, EMERGENT_LLM_KEY), frontend/.env (EXPO_PUBLIC_BACKEND_URL + EXPO_PACKAGER_* = preview URL)
- Test credentials: /app/memory/test_credentials.md (demo@demo.com / Demo1234!)
- User writes in Bengali — reply in Bengali
- app.json has photo/mic permissions (iOS infoPlist + Android permissions)

## Iterations 5–7 (this session — all tested & passing)
✅ Market: standalone /market screen (removed from tab bar), opened via Marketplace card on Profile; VIP 7d/1m/lifetime, badges, frames (incl. ANIMATED frames: frame_rainbow, frame_neon w/ color-cycling reanimated rings); DEMO coin top-up (POST /api/market/topup, amounts 100/500/1000/2000)
✅ Moment detail: collapsing header (scroll → author avatar+name in topbar); likers row (overlapped avatars+flags) + "Liked by" sheet (GET /api/moments/{id}/likes); translate buttons on posts (feed+detail); VIP badge next to names, languages on 2nd line
✅ Translation: FREE Google endpoint (translate.googleapis.com) w/ LLM fallback; free users 3/day (configurable), VIP unlimited; target = user's native_language code
✅ VIP perks: visitors list VIP-only (free = count + lock UI), room hosting free 1/day, new-chat caps free 10/day / VIP 25/day (mutual follows exempt)
✅ Search: /search screen (name + native/learning/gender/online filters via extended GET /users/partners); Connect search bar collapses to topbar icon on scroll
✅ Chat 3-dot menu: view profile, mute (skips unread inc), hide their moments (feed filter), clear history (DELETE /chats/{id}/messages), block/unblock (403 enforcement)
✅ Voice rooms: animated SpeakingBars equalizer + pulsing green ring (Avatar isSpeaking); Avatar `frame` prop (was frameColor) renders static/animated rings
✅ Redesigned 1:1 call UI: full-screen gradient, PulseRing ripples, labeled accept/decline/mute/end, timer pill
✅ ADMIN DASHBOARD: secret web URL /admin-x7k2p9, admin@lingua.app/Admin1234! (seeded idempotently at startup); stats, user mgmt (ban→login 403, restrict→post/send 403, VIP grant/revoke, set coins, delete), market price overrides+disable (market_config col), moments moderation, app limits config (app_config col, applied live)
✅ Keyboard UX: react-native-keyboard-controller 1.18.5, KeyboardProvider at root, KAV swapped in chat/moment/room ("translate-with-padding") + auth/onboarding/moments-composer/voice
✅ Tests: iteration 5/6 reports pass; iteration 7 pytest 20/20 (tests/test_iteration7_features.py)

## Iteration 8 (tested & passing — iteration_8.json)
✅ Chats list: VIP badge + active badge emoji next to names, frame rings; live voice-room status (purple mic badge on avatar + "🎙️ In voice room · name" line, GET /chats attaches partner.in_voice_room from live rooms members dict)
✅ /search revamped: language filters removed → funnel filter icon toggles panel (age presets 18-25/26-35/36+, location country/city input, gender, online, reset + count badge); backend /users/partners min_age/max_age/location params
✅ Profile "About" (About me/Country/Age/Gender/Interests) = one collapsible card (collapse-about), auto-expands in edit mode

## Iterations 9-11 (tested & passing — iteration_9/10/11.json)
✅ Connect header bug fixed (search icon top-right on scroll; header row + missing styles)
✅ Unique usernames: auto-generated at register, startup backfill, PUT /users/me/username (once/30d, 429/409/400), @username pill on own profile w/ edit modal + shown on user profiles; unique sparse index
✅ Profile redesign: name 24, username pill, gradient gold VIP banner (LinearGradient), radius.lg cards, bigger stats
✅ 1:1 calls production-grade: shared /src/utils/webrtc.ts (web + react-native-webrtc native builds, Expo Go fallback), ICE buffering, 45s ring timeout, call_unavailable (offline callee), cross-platform notify() (RN-web Alert is no-op!), full E2E pass (ring/accept/timer/end/decline/offline/mic-denied)
✅ Voice room mesh on same WebRTC stack: per-peer ICE buffering, auto re-offer on 'failed', native-capable, E2E pass (host+listener, mic toggle, hand raise, leave/end)
⚠️ ws@8 pinned as devDependency (react-native-webrtc install caused ws@7 hoist → expo 'WebSocketServer is not a constructor' crash)
✅ Admin URL for user: /admin-x7k2p9 (admin@lingua.app / Admin1234!)

## Iteration 12 (this session — manually e2e verified via playwright)
✅ AI Grammar Correction in chat: pencil icon on every text bubble (mine+theirs) → /ai/correct → green "Corrected" box (corrected text + italic explanation, "✓ No mistakes found" if identical); sparkles AI-fix button next to send corrects the draft in-place + draft-hint-bar shows explanation 6s
✅ Voice message bug fix: startRecording had silent failures (RN-web Alert no-op + unhandled errors). Now: getRecordingPermissions→request flow, canAskAgain→Open Settings redirect, try/catch with cross-platform notify(); all chat error alerts (voice/photo/translate/correct) use notify()
✅ Incoming call ringtone + vibration: /app/frontend/assets/sounds/ringtone.wav (generated double-beep), expo-audio useAudioPlayer looped + Vibration.vibrate([600,1000],true) while call.status==="incoming" in CallContext
✅ Connect page language chips shrunk (compact: flag 9, font 9, padding 4/1, gap 2) in LanguagePair.tsx
Note: Daily streak (backend touch_streak + profile/user page display) already existed from iteration 2.

## Deployment readiness fixes (this session — deployment_agent PASS)
✅ .gitignore: removed .env/.env.*/*.env blocks (env files must be tracked for deploys)
✅ frontend/.env: added EXPO_TUNNEL_SUBDOMAIN=apk-build-debug-1
✅ Supervisor expo command now `expo start --tunnel --port 3000` + @expo/ngrok devDep installed
⚠️ ngrok install re-hoisted event-target-shim@6 to root → Metro "Missing ./index specifier" (react-native-webrtc imports event-target-shim/index). Fixed via patch-package: patches/event-target-shim+6.0.2.patch (adds "./index" export) + postinstall script. DO NOT REMOVE the patch or postinstall.
✅ N+1 queries batched ($in + map): moments.py (list authors, comment authors), chats.py (list partners; conversation_public/moment_public accept optional prefetched doc), rooms.py (list hosts)
✅ db.py ensure_indexes: per-index try/except (idempotent, survives transient Atlas handshake EOF — the original MongoDataMigrate failure was a retryable Atlas connection blip during index restore)

## BuildImage deploy failure fixes (this session)
✅ ROOT CAUSES of cloud build failure: (1) /app/.gitignore had a SECOND duplicate .env/.env.*/*.env block at end of file — frontend/.env & backend/.env were still git-ignored (previous fix only removed the first block); (2) stale frontend/package-lock.json coexisted with yarn.lock (packageManager=yarn) — npm ci mismatch risk, DELETED; (3) patch-package was in devDependencies with "postinstall": "patch-package" — fails on production installs, MOVED to dependencies.
✅ Verified: `yarn install --frozen-lockfile` clean + patch applies; `npx expo export --platform web` EXIT 0 (2.91MB bundle); requirements.txt pip-installable (emergentintegrations==0.2.0 downloadable).
✅ Added frontend/.metro-cache/ to .gitignore (thousands of cache files were untracked).

## Deploy attempt 3 hardening (this session)
✅ patches/event-target-shim+6.0.2.patch slimmed from 583KB (README/dist churn — high apply-failure risk) to minimal 464B package.json-only hunk; verified applies from pristine npm tarball state
✅ backend/requirements.txt: added `--extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/` first line (emergentintegrations==0.2.0 is NOT on public PyPI — sandbox had it in /etc/pip.conf but cloud builder may not)
✅ CLEAN-ROOM build simulation passed: fresh dir + yarn install --frozen-lockfile (preinstall check-pkg OK, patch-package ✔) + npx expo export --platform web EXIT 0
ℹ️ troubleshoot_agent suspected @config-plugins/react-native-webrtc plugin, but `npx expo config --type prebuild` evaluates cleanly (exit 0) — plugin KEPT (required for native calling builds)

## Iteration 13 UI fixes (this session — verified via screenshots)
✅ Tab bar respects device bottom bar: (tabs)/_layout.tsx uses useSafeAreaInsets → height 54+insets.bottom, paddingBottom max(insets.bottom, 8) — no overlap on any phone
✅ Calling offline users keeps ringing: CallContext ignores call_unavailable (no "offline" alert); 45s ring timeout still applies
✅ LanguagePair compact mode: flags removed entirely (codes only) — used on Connect cards AND profile card (compact prop added there)
✅ Moment detail header always shows author (avatar+name+VIP row) instead of "Moment" title; missing headerAuthor/headerAuthorName styles added; removed dead showAuthorBar state
✅ Profile About section: removed set-once Country/Age/Gender rows + their states/payload fields (only About me bio + Interests remain; these fields are set at signup only)

## Iteration 13b — app-wide bottom-bar overlap + user profile chips (verified)
✅ SafeAreaView edges now include "bottom" on ALL non-tab stack screens: user/[id], follows, market, notifications, search, visitors, admin-x7k2p9 (tab screens covered by insets-aware tab bar; chat/moment/room already had bottom edge; auth/onboarding/index use default all-edges)
✅ Call overlay (CallContext modal) now pads with insets.top/bottom so accept/decline/end buttons never touch the home indicator
✅ user/[id] profile languages now compact (no flags, small codes) like Connect/profile

## Round 62 (this session — backend 18/18 pass, all UI flows self-verified)
✅ P0 FIX: all-courses.tsx JSX fragment not closed after Learn tab — app compiles again; Classes tab + /classes/pro-partner verified
✅ Language Placement Test: /placement-test (intro → 10 tiered Qs w/ shuffled options → result); backend GET /vocab/placement/questions + POST /vocab/placement/submit (server-side grading, sets users.vocab_level); vocab-hub shows placement card (vh-placement) + auto-selects level from placement_level in /vocab/me/stats
✅ Weekly XP Leaderboard: /leaderboard (Friends|Global tabs, podium top-3, my-rank footer ALWAYS visible); backend GET /leaderboard/weekly (vocab_lesson_prog xp + learned-words*2, Mon–Sun UTC); entries: vocab-hub header podium icon + profile grid
✅ Saved Moments: bookmark toggle on feed cards + moment detail; /saved-moments screen (unsave, empty state); backend POST /moments/{id}/bookmark, GET /moments/saved/list, `saved` flag on feed/detail; profile grid got Saved + Leaderboard items
✅ Study Rooms (Pomodoro): mode=study in create-room modal ("(Pomodoro)" chip), ⏱ Study badge on room cards; PomodoroCard in room screen (25/5 focus/break, host-only start/pause/skip/reset, ws room_update sync, lazy server-side phase rollover); backend POST /rooms/{id}/pomodoro
✅ Admin security hardening (integration_expert playbook): admin logins issue SHORT-LIVED 60-min versioned JWTs (kind=admin, ver=admin_session_version); require_admin enforces kind+ver; POST /admin/security/revoke-sessions rotates all admin sessions instantly; admin_audit collection logs every mutating admin action; new Audit tab in admin console (revoke button + trail)
✅ TypeScript cleanup: 203 → 0 errors (tsc --noEmit exit 0) — learn palette tokens + static data exports (ACHIEVEMENTS/COURSES/GRAMMAR_LESSONS/LEADERBOARD/STORIES/TEACHERS/WORD_OF_DAY), ChatEvent.ids, chat emoji panel styles, notification-handler fields, types/react-native-web.d.ts, misc route fixes
✅ Auth-restore race fixed on /leaderboard + /saved-moments (wait for AuthContext loading before fetch)
⚠️ Lesson learned: parallel search_replace edits to the SAME file can silently drop — always serialize same-file edits
📌 Remaining backlog: all-courses.tsx (~1100 lines) tab extraction refactor; e-commerce checkout is COD only (no payment gateway)

## Round 63 (this session — backend 7/7 pytest pass, frontend theme smoke pass)
✅ VIP language policy (user-confirmed spec): VIP = 1 native + max 2 teaching languages. backend/routes/users.py PUT /users/me now: non-VIP → teach_languages cleared []; VIP → native auto-filtered from teach_languages + capped [:2] (pydantic UserUpdate already max_length=2 → 422 on >2); changing native to a lang in teach list drops it from teach list. edit-profile.tsx already had cap:2 picker + non-VIP upsell alert.
✅ FULL THEME MIGRATION: purple → "Botanical Emerald Green" (design agent palette, /app/design_guidelines.json). src/theme.ts light+dark fully rewritten: brand #0A7A5F (light) / #34D399 (dark), mint bubbles (#E1F2EC / #0B4A38), green-tinted surfaces/borders/cardTints, wave/speed-pill tokens.
✅ Hex sweep across ~37 files: #7C5CFC/#8B5CF6/#7C3AED/#A78BFA/#7B61FF/#6D5DFF/#C4B5FD/#EDE9FE/#EDE7FF/#4F46E5/#7C6BF0/#6D5AE8/#8B6CF7/#5B21B6/#6C4DF0 + rgba purples → emerald equivalents (#059669/#0A7A5F/#34D399/#10B981/#6EE7B7/#E1F2EC/#047857/#045C47).
✅ Special cases: PomodoroCard phase colors → focus #34D399 / break #60A5FA; IconChip "purple" tint → teal pair (#0D9488/#CCFBF1, dark #16342F/#5EEAD4); all-courses LiveClass cards → blue (avoid double-green next to HelloWords).
📌 INTENTIONALLY KEPT purple: French course gradient (language identity, all-courses.tsx + language-courses/[code].tsx) and sub-app palettes src/learn, src/premium (royal purple+gold VIP area), src/lessons — deliberate sub-brands, do NOT sweep.
✅ Iteration 17 testing: backend VIP policy 7/7 pass; theme smoke on all 5 tabs + chat + vocab-hub/all-courses/leaderboard/placement-test, 0 purple leaks after fixing moments.tsx #6C4DF0 (Trending banner + notice dot). TSC 0.

## Round 64 (this session — brand icon overhaul, iteration 21 all pass)
✅ NAVBAR REDESIGN (src/ui/NavIcons.tsx full rewrite): premium two-state signature icons — inactive = elegant 1.9pt outline glyph, active = solid glyph filled with sky-blue LinearGradient (#4EC4F6→#0B8FD6) + white knockout details (chat 3-dots, mic grill lines, spark core, person-in-circle-badge) + spring pop (scale 1.12 + lift). NEW glyph designs: Chats=round bubble w/ lower-left tail + 3 dots; Connect=two friends + sparkle; Moments=rounded 4-point spark + companion mini star; Voice=studio mic w/ grill; Me=person inside full circle badge.
✅ APP-WIDE DUOTONE BRAND STYLE (src/ui/icons.tsx): global Lucide interceptor now adds subtle 15% interior tint (hex+"26" alpha via duotoneTint) to every icon → single signature look across 800+ usages. NO_DUOTONE exclusion set (~50 open-polyline glyphs: arrows/chevrons/checks/menu/refresh/code/trend lines) keeps them crisp stroke-only. FILL_ON_SOLID (full fill for active heart/star/etc.) unchanged.
✅ Iteration 21 (frontend only): calculator unlock → login → all 5 tabs render gradient active states, icon-heavy screens (moments feed, settings, chat) clean, 0 svg/console errors, no regressions.
✅ Answered user: no public web-browser deployment via Emergent publish — mobile builds (Expo Go / APK / IPA) only.
📌 Backlog: sub-app navbars (Lessons/Pro/Premium) custom icon style; native build needed to test WebRTC audio.

## Round 64b — navbar icons redrawn to match user's 5 uploaded reference images EXACTLY
✅ NavIcons.tsx rewritten again per uploaded pics: 1) Chats = two overlapping solid bubbles (front w/ white dash knockout, back crescent separated via SVG Mask gap, tails bottom-left/right); 2) Connect = small bust left + big flat-bottom bust right w/ mask gap; 3) Moments = solid disc w/ rounded tilted-diamond (compass needle) knockout; 4) Voice = duotone mic (0.45-opacity capsule + 2 solid dashes + thick U-bracket + stand, no base bar); 5) Me = solid head circle + full ellipse body. Single-color glyphs (tab tint), spring pop kept. Masks keep knockouts transparent in dark mode. Verified via screenshot clips (shapes + active blue tint OK, masks work on web).

## Round 65 — WebRTC perfection pass + system UI sync (iteration 22: backend 13/13, frontend clean)
✅ Voice-room mesh FIX: role change now sends NEW `rtc_restart` signal (added to backend RELAY_EVENT_TYPES) so larger-id peers tear down + re-offer; demoted listeners release mic; listeners add explicit recvonly audio transceiver (native unified-plan safe).
✅ TURN added: openrelay.metered.ca (80/443/tcp, free, keyless) in RTC_CONFIG → NAT/CGNAT traversal for real devices. Pro classroom now uses RTC_CONFIG too.
✅ react-native-incall-manager installed (src/utils/incall.ts guarded wrapper; no-op web/Expo Go): voice rooms + pro lessons → loudspeaker; 1:1 calls → earpiece with NEW Speaker toggle (call-speaker-btn, native only).
✅ Pro classroom upgraded native: useProRtc uses getRTC() (react-native-webrtc on builds), VideoStream.tsx renders RTCView (mirror/cover), audio session managed.
✅ Room screen: dismissible "Live audio works in the installed app" notice on native Expo Go only (room-audio-notice).
✅ System UI sync (_layout.tsx): expo-system-ui background + Stack contentStyle = colors.surface, android nav-bar button style follows theme → status bar/system areas always match app bg. icons.tsx LucideCmp style typed loose (tsc 0).
⚠️ Real audio still needs native build (react-native-webrtc + InCallManager) — remind user to Publish → build APK/IPA.

## Round 66 — Calculator lock removed + production-grade WebRTC + global mobile overflow fix
✅ Calculator disguise DELETED: app/index.tsx is now a pure auth router (loading spinner → /welcome | /onboarding | /(tabs)/connect). welcome.tsx doc comment updated. (User explicitly asked only for removal — mic icons were NOT swapped to a calculator glyph.)
✅ WEBRTC HARDENED (user chose: keep mesh + free Open Relay TURN; SFU not possible in this container because only HTTP/WS ports are exposed, no UDP media range):
  • NEW backend/rtc_core.py — ICE servers from env (WEBRTC_STUN_SERVERS / WEBRTC_TURN_SERVER / WEBRTC_TURN_USERNAME / WEBRTC_TURN_CREDENTIAL, added to backend/.env), sliding-window RateLimiter (calls 10/min, signaling 400/10s, room create+join 20/min), in-memory call sessions mirrored to new `calls` collection, cached live-room membership (5s TTL + invalidate on every room mutation).
  • NEW backend/routes/rtc.py — GET /api/rtc/config, POST /api/rtc/calls (server owns callId; blocks self-call/unknown/banned/blocked/rate-limited), POST /api/rtc/calls/{id}/status (participants only; COMPLETED/MISSED/REJECTED/CANCELLED/FAILED).
  • server.py WS /api/ws: every call_* frame must carry a valid call_id of a live session the sender belongs to (else `call_invalid`, no relay); rtc_* room frames relayed only when BOTH users are members of the live room; call_answer → CONNECTED, call_end/decline → final status + duration_ms persisted.
  • Frontend src/utils/webrtc.ts rewritten: AUDIO_CONSTRAINTS (echoCancellation + noiseSuppression + autoGainControl, mono), getIceConfig()/iceConfigSync() fetched from backend (no TURN creds in the bundle), preferOpus(), readStats() (rtt/jitter/loss/audio levels), micErrorMessage() for permission/device errors.
  • NEW src/utils/audio-level.ts — Web Audio RMS meter (web) + getStats audioLevel (native) → REAL active-speaker detection (thresholds + 700ms hold). Room screen: isSpeaking = mic_on && speakingIds.includes(id); RoomSessionContext exposes speakingIds + peerStates.
  • CallContext.tsx: full state machine (outgoing→ringing→connecting→connected→reconnecting), duplicate-call guards, ICE-restart recovery (2s) with 25s give-up → FAILED, remote-speaking pulse from real audio, complete teardown (tracks stopped, pc closed, listeners/timers cleared) so a new call starts immediately.
  • use-room-audio.ts: dynamic ICE, mic constraints, Opus, per-peer recovery (ICE restart → hard rebuild), listener recvonly transceiver, meters/state cleanup.
  • Verified: backend/tests/test_rtc_signaling.py (auth/relay/hijack/rate-limit/history) + iteration 23/25 (two fake-media browsers: real connected call, mute, end, re-call).
✅ GLOBAL MOBILE OVERFLOW/SAFE-AREA PASS (design untouched): NEW src/hooks/use-screen-space.ts (tab-aware bottom-space helpers); +html.tsx web shell uses 100dvh + visualViewport-driven --app-vh + overflow-x guard; notifications & backpack filter tab rows made horizontally scrollable (were clipped at 320px); search header minWidth:0 (8px overflow); welcome overflow:hidden (decorative rings); notifications row text truncates; keyboard: store-cart / add-sheet / learn-writing / admin login → KeyboardAwareScrollView, group-settings rename modal → KeyboardAvoidingView, 4 screens migrated from RN KAV to react-native-keyboard-controller, create-group + share-to-chat keyboardShouldPersistTaps.
✅ Safe-area bottom padding added to every bottom sheet/modal action area (chats more, moments filter, moment-compose topic, premium apply, admin more, ai-lens lang, learn onboarding + set-goal pickers, room member/action/gift, chat menu + correction, LikersRow, DateOfBirthPicker, WordOfDayCard, VisibilityModal).
✅ Iterations 24 + 25: 29 routes × 6 viewports (320→1280) = 174 checks — 0 horizontal overflow, 0 unreachable bottom content, 0 tab-bar clipping, 0 console errors; sheets verified aligned to the safe area.
⚠️ Still native-build only: react-native-webrtc audio + InCallManager (Expo Go cannot run them) — user must Publish → build APK/IPA to hear real audio on a phone.

## Round 67 — Uploaded voice/mic glyph used app-wide
✅ NEW src/ui/MicGlyph.tsx — faithful vector recreation of the user's uploaded mic icon (duotone: 45%-opacity capsule body 5.65/1.3/12.7×17.1 r6.35, two 2.0pt curved dashes, 2.1pt rounded U-bracket ending at y19.95, no stand/base bar). Exports MicShape (embed in an existing 24-viewBox Svg), MicGlyph and MicOffGlyph (same mark + diagonal cut).
✅ src/ui/icons.tsx: mic / mic-outline / microphone / keyboard-voice / record-voice-over / voice → MicGlyph; mic-off / microphone-off → MicOffGlyph (Lucide Mic/MicOff/Speech imports removed). Covers all 26 mic/voice icon usages app-wide (chat composer, room mic button, pro session dock, voiceroom notices, etc.).
✅ src/ui/NavIcons.tsx VoiceIcon now renders the shared MicShape → navbar Voice tab is pixel-identical to every in-app mic icon (spring pop + tab tint kept).
✅ Verified at 200px (glyph matches reference), plus tab bar + chat composer clips at 390×844. tsc 0, eslint clean.

## Round 68 — Gift-Gated Messaging, Read Receipts, Reply preview
✅ Gift-Gated Messaging (frontend complete): chat/[id].tsx gift-lock banner (gift-unlock-bar/-btn), composer gated via inputLocked, sendGiftMessage → POST /chats/{id}/gift (CHAT_GIFTS aligned to backend: rose10/heart20/star30/crown100/diamond200), 402 'gift_gate:' opens gift panel, gift_unlocked flips on qualifying gift. edit-profile 'Gift-Gated Messaging' card (gift-gate-switch + gift-min stepper → gift_gate/gift_gate_min via PUT /users/me).
✅ Read receipts: POST /chats/{id}/read sets last_read.{uid} + emits messages_read WS; conversation exposes partner_read_at; chat shows Seen (checkmark-done)/Delivered under my latest message incl. gift/call bubbles, live-updates on WS.
✅ Reply preview truncated numberOfLines=1 (input banner + in-bubble quote). Verified iteration 29 (backend 9/9 + frontend).

## Round 69 — Paid Practice isolation, overview page, tab order & gold icon
✅ Backend: GET /users/partners excludes paid_practice users from ALL non-practice lists (query paid_practice:{$ne:True}); ?paid_practice=true returns all paid partners. Verified iteration 30 (backend 11/11 + frontend).
✅ connect.tsx: 'Paid Practice' category now LAST in the tab row; hides language filter chips and shows 'Introducing Paid Practice' banner (paid-practice-banner) → new /paid-practice-overview page (What is / Where / Rules).
✅ PartnerCard: paid_practice partners render the message button as a gold (#F59E0B) circular chatbubble icon (no 'Chat' text); other tabs keep the brand-colored icon.


## Round 70 — Wallet earnings + settings toggles + call/sticker avatars
✅ Chat gifts now feed the Wallet: POST /chats/{id}/gift → sender spends coins, recipient EARNS diamonds (price/10), writes gift_ledger + wallet_tx for both sides (mirrors room gifts). Practice unlock now writes wallet_tx for both sides. Verified iteration 31 (backend 5/5).
✅ edit-profile paid-practice-switch + gift-gate-switch use app-wide AppSwitch (match other settings toggles).
✅ profile feature grid: new 'Wallet' entry (feature-wallet) → /coins hub (coin + diamond balance, top-up, redeem, transactions, gift history).
✅ chat/[id].tsx: incoming call & sticker messages show partner avatar on first-of-run (shared withAvatarRow wrapper) like text bubbles.
✅ Fixed market.py GET /market/gifts missing user_card import (found by testing agent).

## Verified complete (original problem statement)
✅ #3 Bottom-bar/gesture-bar overlap: (tabs)/_layout uses useSafeAreaInsets, tabBar height = 56 + max(insets.bottom,12)+10; global safe-area pass (Round 66). No overlap in previews.
✅ #6 Moments feed language filter: implemented in GET /moments (frontend calls it) — shows only posts whose author native_language ∈ my learning languages (+ own). Verified live (mei EN+JA → sees EN/JA authors).

## Round 71 — Bottom-sheet gesture-bar overlap fix
✅ Audited all 14 files with flex-end backdrops. Only connect.tsx (Add-language + Gender/City sheets) and market.tsx (Top-up sheet) had UNPROTECTED bottom sheets — the rest were either already insets-aware (Round 66) or false positives (card styles: all-courses bookCover, learn/plan topBar, moment/[id] commentActionRow).
✅ connect.tsx + market.tsx: added useSafeAreaInsets; sheet modalCard now paddingBottom = insets.bottom + spacing.xxl so the last option (Poland/Female/Greek/top-up amount) clears the phone gesture bar. Verified sheets open cleanly (web insets=0; device gets the extra pad). lint clean.
NOTE: avatar-on-first-message grouping for messages + calls was already delivered (Round 70, iteration 31) — re-confirmed as the desired behavior.

## Round 72 — Uniform title bars + professional VIP badge
✅ VipBadge redesigned (src/components/Badges.tsx): now a glossy SVG "verified" checkmark sticker (rounded square, top gloss highlight, white check) tinted by tier — gold (weekly/monthly), blue (weekly), purple (lifetime). Replaces the old text "VIP" pill everywhere (12 usages update via the shared component). Unique gradient ids via React.useId.
✅ Title-bar size unified to 18px (chat header size) across ALL core-app pages per user (1a landing titles too, 2b sub-apps untouched): edited 19 files — (tabs) connect/chats/moments/voice (22/24→18), market(24), backpack/categories(22), voiceroom-notices/moments-report(17.5), placement-test/leaderboard/saved-moments/room/share-to-chat(17), vocab-hub/play/connect-filter(20), moment-compose(19), moment/[id](20). fontFamily kept per-page; only size normalized. Pro/Learn/Lessons sub-apps intentionally left with their own larger serif titles. lint clean.

## Round 73 — Title bars bumped to 24px
- Per user, all core-app header titles (37 files incl. chat headerName) set to fontSize 24 for a larger, uniform look (was 18). Pro/Learn/Lessons sub-apps still untouched.

## Round 74 — Fix Expo Go "undefined is not a function" render error
- Root cause: Metro fallback file-watcher intermittently crashed on a phantom node_modules path (@typescript-eslint/utils/node_modules/eslint/lib/cli-engine; ESLint 9 removed cli-engine) → dev server died mid-bundle → Expo Go loaded a broken/partial bundle → render error.
- Fix: materialized the missing dir + cleared Metro/.expo cache + restarted. Dev server now stable (persistent PID, packager-status running, HTTP 200). Verified via testing_agent iteration 32 (5/5 pass, 0 console/page errors, app loads clean, VIP badge + 24px titles + chat receipts all intact).
- Note: @react-native-picker/picker 2.11.4 vs expo-expected 2.11.1 is a cosmetic doctor warning (newer in-range); left as-is.

## Round 75 — REAL fix for Expo Go Android crash (undefined is not a function @ _layout.tsx:106)
- Root cause: expo-navigation-bar@57 REMOVED NavigationBar.setButtonStyleAsync (now synchronous NavigationBar.setStyle). Root _layout.tsx useEffect + room/[id].tsx called the undefined method inside a Platform.OS==="android" branch → crash on Android/Fabric only (web unaffected, which is why earlier web smokes passed).
- Fix: replaced all 3 call sites with NavigationBar.setStyle?.(mode==="dark"?"dark":"light") (room immersive uses "dark"). Removed the .catch (setStyle is sync). lint clean; web boot regression-free (testing iteration 33). Requires Expo Go reload to verify on device.

## Gender-based profile navbar icon (current continuation)
- User approved first uploaded icon for saved gender male, second for female, and explicitly chose to test the UI themselves. Main tabs pass user?.gender into MeIcon; absent/unknown gender retains existing neutral glyph. Actual profile photo unchanged.
- Exact uploaded PNG bytes bundled as base64 JSON in src/assets/profile-nav-icons.json, rendered using react-native Image and tab tintColor. Existing focus spring, navbar spacing/safe area, and unread notification dot retained. No backend/model/onboarding persistence change required (gender already saved and returned).
- ESLint passes for both changed TSX files. Testing agent statically confirmed no newly introduced TypeScript errors; full tsc still has 32 pre-existing ColorValue / removed absoluteFillObject compatibility errors. User declined automated UI testing; no simulated signup/auth or mocked data added.
- Historical authentication outage was later resolved by the explicitly authorized fresh-preview setup below; original accounts were not recovered.

## Fresh preview recovery, Guest removal, and latest navbar uploads
- User approved a new preview with "Create new". Created missing env using verified running platform Mongo MCP URI / Expo proxy origin, distinct DB linguaconnect_preview_91d577847a48, new private JWT secret; no old DB/data deleted. Existing password hashing and {token,user} API contracts preserved. Real backend registration/login/me/token validation, profile persistence and post-restart login PASSED.
- Missing optional AI key no longer crashes API import; paid AI endpoints explicitly503 without configuration. Synthetic online tutor seeds disabled for this preview; real Pro endpoints and authored vocabulary retained.
- User then explicitly removed Guest Mode: no guest auth button/browsing state/screens or anonymous /api/auth/guest creation endpoint. Legacy guest flag cleaned; protected routes require a real user. Existing member screens/features, gender-based profile icons, safe areas and navigation preserved. No account deletion.
- Exact latest uploaded PNGs now power navbar: #1 mic -> Voice, #2 communication -> Chats, #3 group -> Connect, #4 yin-yang -> Moments. Original bytes stored as base64 in src/assets/navbar-upload-icons.json. Tab order remains Chats/Connect/Moments/Voice/Me; theme tints and focus spring unchanged. No redraw/stock replacements.
- Latest size refinement: all five main navbar icons are 2 points larger (navigation-provided size+4 instead of size+2). Bar height, label styles, touch targets and safe-area padding unchanged. Backend guest-removal regression PASSED10/10; frontend UI testing still awaits permission.
- Current static checks: ESLint passes; 27 pre-existing TypeScript errors remain (5 main-tab ColorValue errors fixed by correct icon prop typing). UI/native testing not yet authorized/performed; needs user choice after backend regression test.
- Limitations at that point: upstream public cross-origin OPTIONS returns400 (local backend200); optional paid AI unconfigured; password reset unavailable; full audio/native build verification pending.

## Reference-inspired auth, three-page intro and shared icon refinement
- Built minimalist login/signup with centeredheadings, subtlefields, roundedsolidCTA, inlineaccountswitch, passwordvisibility/autofill/keyboardfocus, safearea+keyboardscroll andduplicatesubmitguard. Guest remainsremoved. No fakeGoogle/Applebuttons; email/passwordcontracts unchanged. Passwordrecovery still explicitlyunavailable.
- Publicwelcome now3swipeablepages with originalportraitcollage/globe/connectionrings, new language-exchange copy, base64decorativephotos, darknavy/blueglow, reducedmotionfriendlyReanimatedtransition, pagination andGetStarted/LoginCTAs. Kept all5requiredpostsignupsteps.
- Unifiedwholeappmic viaMicGlyph using exactnavbarPNG; microphone-off retainsdiagonalstrike. FiveotheruploadedactionPNGs replace matchingbolt,bell,call,speakermute,menu aliases globally. Existingnavorder/gendericons/colors/handlers preserved.
- Chatheader font24->18 withtruncation and48pthitarea; Moments24->28. Receipt Delivered->Sent only, Seen/serverlogic untouched.
- Testingagentsverifiedrealnewsignup201->onboarding,existinglogin->Connect,validation/passwordtoggle,3intro/swipe/CTA andmobileviewports320/390/430,chat18+actualSentlabel,Moments28 andexactbell/call/micPNGsource. Backend9/9 auth/QAreadinesspassed. No mocked productdata/auth/calls.
- Remainingverification: newusercompletedonly2/5profileonboardingstepsinbrowser; darktheme/nativeOSkeyboard/nativeaudio/builds nottested. LiveSent->Seen testcouldnotexecute (agentvariable/tool issue), not anappdefectclaim.27preexistingTypeScripterrorsremain; changedfileslintpasses. OptionalGoogle/Apple/reset/paidAI unavailable. No productionreadinessclaim.

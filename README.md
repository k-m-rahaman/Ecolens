# EcoLens Pro

A free, multilingual campus waste-sorting web app with local AI, optional online vision, eco quests and clearly labelled impact estimates.

**Use EcoLens:** https://ecolens-live.web.app/ · **Public NAAC report:** https://ecolens-live-naac.web.app/

The public app works on laptop and phone browsers. Profiles and progress stay on the visitor's device. Photos stay local in Offline mode; Online mode can send a scan photo to Google only after separate permission in Settings. Only anonymous institution totals are shared with the public NAAC report after opting in. Prepare offline once while connected to use the local scanner without internet. The first model download is approximately 45 MB.

This Firebase build includes optional Google Gemini vision through Firebase AI Logic, protected by Firebase App Check. It uses the Gemini Developer API on a project with billing disabled, alongside the on-device scanner. It needs no user-supplied AI key. The public website's deployed version determines whether this connection is available; a configured status alone does not prove a successful cloud scan.

## Start

Open this folder in VS Code and use **Go Live** to run the static app. Camera access needs localhost or HTTPS. Do not open `index.html` directly as a file.

For the included local online gateway, install Node.js 20 or newer and run:

```sh
npm start
```

No package installation is needed. Open `http://127.0.0.1:8787`. The server starts without an AI key and offline scanning works independently.

### Try it on a phone

For a photo-upload preview on a phone connected to the same Wi-Fi, run:

```sh
npm start -- --lan
```

Open the private-network URL printed by the server on your phone. This opt-in preview listens on the local network and accepts private IPv4 hosts only; `LAN_PREVIEW=1` enables the same behavior and optional `LAN_HOSTS` adds private IPv4 addresses. Keep it for a trusted local network. Local development uses the optional server gateway described below; the Firebase cloud connection is restricted to its configured hosted domains.

Phone browsers require **HTTPS** for live camera access and service-worker offline preparation. The plain HTTP LAN preview supports uploaded photos and on-device analysis while the phone can reach the laptop, but does not provide a reliable disconnected reload. Use an HTTPS deployment to test the phone camera and **Prepare offline** flow. Localhost on the laptop also supports those features. Each browser origin has its own stored profiles and offline files.

## Scanning and appearance

Use **Open camera** and **Capture item**, or **Upload a photo**, on a laptop, tablet or phone. The camera opens with the rear camera preferred on phones; **Switch camera** cycles available cameras after permission is granted. A laptop with one camera has no camera-switch action. Upload remains available when camera access is blocked. Keep one discarded item in good light and check the suggested route against the campus label.

The scanner prepares its models in the background, reuses loaded models, and runs material and object checks together. A supported browser runs the waste model in a worker; a compatibility fallback is available. These changes reduce repeated setup work, but the first visit and slower devices can still take longer.

The photo stays visible with a compact progress panel and elapsed time. A preliminary material result may appear while the food/electronics/background check finishes; it stays unconfirmed until required checks finish. In Online mode, a completed local result can appear while cloud vision refines it. Choose **Use this result** to stop waiting for the optional online check; any required local check finishes before a quest can begin. **Cancel scan** stops the current scan flow so you can retake or upload another item. The online wait is limited to about 12 seconds, with local fallback when available. Neither speed nor recognition accuracy has been benchmarked on a held-out campus photo set.

Use the sun/moon button in the top bar to switch between light and dark, or choose **Settings → Appearance → Match device / Light / Dark**. Match device is the default and follows the operating system. The choice is saved with your local data and included in backups. Touch controls, responsive camera framing and safe-area spacing support laptop and phone layouts; Reduce animation remains available in Settings.

## Offline mode

All AI scripts, WebAssembly and model weights are bundled locally. The app uses the original eight-class waste model through ONNX Runtime Web, with a general-object COCO-SSD helper for food, discarded electronics and non-waste detection. The ONNX graph was converted to FP32 and sorted topologically for broad browser runtime compatibility; the learned weights/classes have not been retrained.

Use **Prepare offline** once before disconnecting. Wait for completion. The service worker caches the interface and model files, approximately 45 MB. Browser storage eviction or clearing site data requires preparing again. Native voices depend on voices installed on the device; written English, Bengali and Hindi instructions work independently.

The waste model classes are bag, cardboard, furniture, glass, metal, paper, plastic and yard. Its tensor shapes are `[1,3,640,640]` input and `[1,12,8400]` output. Unsupported items, ambiguous plastics, weak results and unknown materials require confirmation. Confidence is a model score, not a measured accuracy guarantee. Campus bin labels and local collection arrangements take precedence over the illustrative color mapping.

## Online mode and keeping it free

On the Firebase-hosted app, open **Settings**, read the Google photo-sharing notice, enable **Allow my scan photos to be sent to Google Gemini when I choose Online mode**, and save. Then select **Online** on the scanner. Leave the optional custom scanner address empty to use the built-in Firebase connection. Photo permission starts off and can be withdrawn at any time. Changing the destination requires fresh permission; restoring a progress backup does not grant Google photo permission.

Online mode starts local analysis and a Firebase AI Logic image request together. The default model is the fast `gemini-3.5-flash-lite`; the client configuration also permits `gemini-3.8-flash`. It does not automatically switch to a paid provider or model. The whole cloud attempt has an approximately 12-second limit, including SDK preparation and attestation. When the connection fails, the limit expires, the free quota is unavailable, or the device is offline, the app uses local analysis when available. **Use this result** lets you accept a completed local result while cloud refinement is pending. The local scanner needs no AI key or subscription.

Google's free Gemini service may use submitted photos to improve its products. Scan requests include the photo and sorting instructions, not student names, profiles, XP or personal history. This photo permission is separate from public NAAC sharing, which never publishes photos or personal records. Firebase App Check uses a restricted reCAPTCHA Enterprise website key to attest cloud requests. The Firebase web configuration and site key are public identifiers, not administrator credentials or a private Gemini API key.

Keep the Firebase project on **Spark** with billing disabled. Free quotas and model availability can change; reaching a quota can make cloud scanning unavailable, while the local scanner remains available. This build does not enable billing, Cloud Functions or a paid fallback. See [Firebase AI Logic pricing](https://firebase.google.com/docs/ai-logic/pricing), [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) and [Firebase App Check](https://firebase.google.com/docs/ai-logic/app-check).

### Optional local or custom gateway

`npm start` on localhost uses the included `/api/analyze` server rather than the hosted Firebase connection. An optional **Use a different scanner** setting accepts a custom HTTPS gateway. Those services have their own configuration and limits; they are not needed to use the Firebase-hosted app.

For local cloud scanning, copy `.env.example` to `.env`, set the fresh server key and explicitly set `FREE_TIER_ONLY=1` only after checking the project has no billing. Start with:

```sh
node --env-file=.env server.mjs
```

In the local app's Settings, enable image-upload consent and save. An empty endpoint uses the server's `/api/analyze`. When using Go Live or GitHub Pages instead, enter the deployed HTTPS gateway URL and configure its allowed origin to exactly match the website. Never put a private Gemini key in webpage code, Git commits, screenshots or chat; use a server environment variable or deployment secret. Check the gateway's supported models against current provider availability before using it.

Defaults cap the optional gateway at 20 requests per UTC day and three per minute, with a per-client cooldown. These gateway limits do not apply to Firebase AI Logic, which uses Google's service quotas. Local gateway caps persist in ignored `.ecolens/quota.json`. The included Cloudflare Worker requires its `EcoLensQuota` Durable Object binding, configured in `wrangler.toml`, for a cap shared across worker instances. It is an alternative deployment and is not required for the Firebase setup.

## What changed

- Responsive laptop, tablet and phone interface, light/dark/device themes, lightweight transitions and celebration animations with reduced-motion support.
- Background model preparation, concurrent local checks, partial previews, compact progress, scan cancellation and bounded cloud refinement with local-result selection.
- Complete UI/quest/tutorial guidance in English, Bengali and Hindi.
- 34 officially sourced institutions in Kolkata and nearby areas, searchable by name/area, plus custom institutions. They are selectable communities, not claimed partners.
- Ten XP levels, date-based streaks, lifetime quest totals, and four working upcycling tutorials.
- Instance-aware routing, actual center camera crop, safe unknown state and explicit material corrections.
- Quests award once per completion ID; a recent identical image cannot earn repeated rewards. A tutorial rewards once per profile per local calendar day. These are local protections, not proof of a unique physical disposal.
- Logging in adds no waste or CO₂. Personal and device-campus totals derive from the same event ledger.
- Clearly labelled self-reported completion and illustrative mass/CO₂ estimates. Optional entered weight stays distinguishable from assumed weight.
- JSON backup/restore and CSV activity export.
- Safe text rendering, server-only AI secrets, schema validation, quota caps and recoverable fallback.

## Mixed waste, material checks and student reports

Choose **Mixed waste** above the camera to analyse a group of items. Camera capture uses the full frame in this mode. The result lists numbered items, separates different materials from different disposal destinations, and gives separation guidance. Spread items out so they are visible; hidden contents are not inferred. Use **Add a missed item** to name an omitted object and confirm its material and campus bin.

Bottle, flask, cup and bowl shapes cannot establish material reliably. The scanner asks for actual material confirmation rather than presenting a confident metal/glass/plastic guess. Select the material, check the campus collection stream and choose **Confirm material & campus bin**. The material stays editable after confirmation. A container may be reusable: choose **Keep / reuse this item** to exclude it from disposal impact, or explicitly confirm disposal. An undecided container cannot silently disappear from a mixed-scene quest.

Local group inference includes smaller peripheral items without lowering model score requirements. Conflicting, heavily overlapping class boxes are merged as one unresolved item; separate visible objects remain separate. Firebase cloud requests preserve the full photo's proportions and resize it to a maximum edge of 960 pixels. The optional server gateway uses a 1024-pixel edge for groups and 768 pixels for a single item. No learned weights were retrained and no recognition accuracy percentage is claimed.

Open **NAAC Reports** in the main navigation, or its shortcut on the Impact page. The directory lists every university, college and school in the 34-institution catalog, plus saved custom institutions, regardless of the current student profile. Search by name/area, filter the institution type, then choose **Open NAAC report** or use the populated institution selector. First-time visitors can browse reports before creating a student profile.

Each report includes estimated landfill diversion, estimated CO₂, contributing students, items handled, completed quests, activity XP, per-student contributions and CSV downloads. Export a single institution, all institutions, or student contributions. Institutions without saved activity remain listed with **No recorded activity yet**. This means no records in this browser, rather than a claim about the institution's real waste performance. Student rows and institution totals use the same completion ledger. User-reported weights and assumed weights remain distinct. Legacy XP does not count as newly contributed waste or earned activity XP. These are self-reported browser records for reporting support, with no claim of certification or a connected campus-wide service.

EcoLens now uses its own leaf/lens/orbit symbol across the sidebar, mobile header, welcome screen, about card and app icon. Editable vector branding files are in `assets/ecolens-mark.svg`, `assets/ecolens-logo.svg` and `assets/ecolens-brand-guide.md`.

## Public NAAC reports with private personal records

Public report: [EcoLens NAAC Reports](https://ecolens-live-naac.web.app/).

The standalone `naac/` website is the public report view. Its separate Firebase Hosting site publishes only that folder. It reads shared institution totals from the public `ecolensNaacV1/publicInstitutions` node in Firebase Realtime Database. Student names, local profile IDs, photos, XP, corrections, image fingerprints and personal events are never uploaded to that report. Named student rows in the local EcoLens report remain private in that browser. Optional Google scan-photo sharing is a separate setting and does not publish the photo in NAAC reports.

Settings includes a separate **Public NAAC sharing** section. Enter the public service address, enable **Share anonymous institution totals only**, and save. Only totals for catalog institutions are transmitted. Custom institutions stay private. Offline records remain local and can sync after reconnection. The public page can be read without a student profile or publishing token.

A Firebase anonymous sharing identity and increasing request revision stay under separate browser-storage keys and are excluded from the JSON progress backup. The identity is created only after opting in; public visitors do not sign in. Each browser replaces its own previous totals; retries do not add them again. Private database contributions and global revision markers can be read only by their owner. Atomic updates and security rules prevent a delayed request from undoing a newer update or removal. Turning sharing off removes that browser's contribution when connected; failed removal stays queued and can be retried by saving again. Restoring a backup turns public sharing off until enabled again. Copying the same progress backup to several devices and opting in on each can count those records more than once; this is not a verified student identity service.

Public values remain self-reported estimates. Contributing-profile counts are not verified unique students across devices, and this is reporting support rather than a certified NAAC waste audit.

The Firebase integration uses the **Spark** plan, Firebase Hosting, Realtime Database, anonymous Authentication, AI Logic and App Check. It has no Cloud Functions, Cloud Run, App Hosting, Cloud Storage or billing setup. No payment method is needed on Spark. If free limits are reached, the affected service can become unavailable; this build never enables paid billing. [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Firebase pricing](https://firebase.google.com/pricing).

`firebase.json` uses two Hosting targets: `app` serves the generated `dist/` frontend on `ecolens-live`, and `naac` serves the standalone report on `ecolens-live-naac`. `npm run build:static` prepares only the reviewed public asset list; it excludes server code, tests, database rules, `.env`, Git metadata and local student data. Deploy the app with `firebase deploy --only hosting:app --project ecolens-live` after building. Deploy the report separately with `--only hosting:naac`. Neither command changes database rules or enables billing.

`naac/firebase-config.json` contains public Firebase web configuration only: version, provider, project ID, web API key and default database URL. Never include administrator keys or service-account credentials. `DEFAULT_PUBLIC_NAAC_URL` in `public-config.js` points to the shared report. The app also starts locally with `npm start`. Each origin has its own browser data; previously saved localhost profiles are not automatically moved to the public website. Export and import a progress backup to transfer them, then opt in again if you want anonymous totals shared.

`firebase.naac.rules.json` is a mergeable report namespace; `firebase.database.rules.json` is the complete deny-default template for a new database. Existing rules must be inspected and merged before deployment. A permissive ancestor read/write grant cannot be overridden by a child rule, so the merge helper refuses unsafe root grants. Never deploy the complete new-database template over unrelated existing rules. `generate-firebase-rules.mjs` generates the known institution whitelist and exact numeric validation. Integer microkilograms keep replacement and removal arithmetic exact.

For isolated rule validation, use `firebase emulators:exec --only auth,database --project demo-ecolens --config firebase.emulators.json "node --test firebase-rules.test.mjs"`. The test installs its rules only in the local demo emulator and never contacts the real project.

## Data scope

Profiles, progress, corrections and events stay in this browser. Local campus totals aggregate profiles on this device only; the separate public report combines opted-in anonymous institution totals across devices. There are no invented live-network figures. This build does not present local student profiles as authenticated accounts, and does not claim an official NAAC accreditation result or an audited multi-campus administrator service.

Previous BWU/JU/TIU XP can be preserved when a matching profile is opened on the same browser origin. Old browser keys are left untouched. No old disposal history or impact is fabricated; legacy XP does not enter campus disposal totals. To move the new ledger between devices, export and restore a JSON backup. Restoring a backup replaces the current ledger after confirmation.

## Checks

```sh
npm test
```

The saved tests cover the event ledger, streaks, duplicate rewards, legacy XP, image preprocessing/decoding, uncertainty, cloud request contracts, Firebase photo permission, cancellation and timeouts, safe server paths, origin checks, error sanitization and persistent gateway quotas. Additional implementation QA exercised the translated interface and upcycling journey in a DOM harness, and ran the real FP32 model through the bundled WebAssembly runtime.

Automated tests do not prove that a deployed provider connection is healthy. Confirm a real cloud response on the hosted site, including the **Cloud vision** result source, before presenting. No accuracy percentage has been measured on a held-out campus photo set. Check actual camera operation, phone performance, ambiguous materials and a full service-worker disconnect/reload on the presentation devices.

## Project layout

The HTML loads `bootstrap.js` and the complete generated interface from its versioned `releases/` directory. New release paths bypass older service-worker caches that could otherwise mix a new page with old translations/scripts. The worker downloads a complete interface before activating it; online interface files are refreshed, while unchanged model weights keep their existing cache. Saved profiles and progress are not cleared. Offline readiness requires both the interface and model pack.

`npm start` prepares the generated interface automatically before serving. After editing source files for a static preview, run `npm run build`; the generated release files are also included in this source archive. When shipping a later interface release, use a new release directory/version consistently in the builder, bootstrap, HTML and worker.

`index.html`, `styles.css`, `app.js` form the interface. `data.js` contains translations, routes, institutions and tutorials. `core.js` owns the ledger. `inference.js` owns model processing; `scan-flow.js` coordinates cancellation, previews and online fallback; `firebase-ai.js` connects the optional Google scan using public settings in `firebase-ai-config.js`; `media.js` handles camera preferences and photo decoding; `report.js` builds campus contribution CSV files. `sw.js` caches the offline app. `server.mjs` and `cloudflare-worker.mjs` provide alternative protected online gateways. `vendor/` and `models/` contain local runtime assets. Original branding and design contributions are retained in `assets/` and `design/`.

Original project lead: Kazi Mustafijur Rahaman. Original UI/UX design: Anisha Aktar. Original systems/flowchart design: Koyel Basu.

Third-party runtime and model sources are documented in `THIRD_PARTY_NOTICES.md`.

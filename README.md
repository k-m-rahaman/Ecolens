# EcoLens Pro

A free, multilingual campus waste-sorting web app with local AI, optional online vision, eco quests and clearly labelled impact estimates.

**Use EcoLens:** https://ecolens-live.web.app/ · **Public NAAC report:** https://ecolens-live-naac.web.app/

The public app works on laptop and phone browsers. Profiles, photos and progress stay on the visitor's device. Only anonymous institution totals are shared after opting in. Prepare offline once while connected to use the local scanner without internet. The first model download is approximately 45 MB.

The Firebase-hosted app uses on-device detection in both modes until a separate HTTPS cloud vision gateway is connected. It skips unavailable cloud requests immediately. Firebase Spark serves the website and public NAAC data without running a paid server; cloud refinement has not been deployed.

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

Open the private-network URL printed by the server on your phone. This opt-in preview listens on the local network and accepts private IPv4 hosts only; `LAN_PREVIEW=1` enables the same behavior and optional `LAN_HOSTS` adds private IPv4 addresses. Keep it for a trusted local network. Online AI remains disabled without the separate key/free-tier configuration below.

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

Online mode runs local analysis alongside the protected `/api/analyze` request for richer item/material/separation guidance from Gemini. It uploads an image only after cloud-image consent is enabled in Settings. If the gateway is unavailable, the wait expires, quota is reached, or internet is absent, the app clearly reports local fallback. Online requests are disabled by default; the local scanner needs no AI key or subscription.

Google currently lists a free tier for Gemini 2.5 Flash. A fresh key must belong to a project without billing enabled to keep provider usage free. A server flag cannot determine the provider account's billing state. No subscription or paid service is required by the app, and no paid backup provider is used. Provider quotas and availability can change. [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

The old key embedded in the previous frontend should be replaced. Do not put a replacement in webpage code, Git commits, screenshots, or chat. Configure it as a server environment variable or deployment secret.

For local cloud scanning, copy `.env.example` to `.env`, set the fresh server key and explicitly set `FREE_TIER_ONLY=1` only after checking the project has no billing. Start with:

```sh
node --env-file=.env server.mjs
```

In the app's Settings, enable image-upload consent and save. An empty endpoint uses the server's `/api/analyze`. When using Go Live or GitHub Pages instead, enter the deployed HTTPS gateway URL and configure its allowed origin to exactly match the website.

Defaults cap the gateway at 20 requests per UTC day and three per minute, with a per-client cooldown. Local caps persist in ignored `.ecolens/quota.json`. The included Cloudflare Worker requires its `EcoLensQuota` Durable Object binding, configured in `wrangler.toml`, for a cap shared across worker instances. Worker/cloud hosting is not deployed by this local update. Verify the hosting plan's included limits separately.

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

Local group inference includes smaller peripheral items without lowering model score requirements. Conflicting, heavily overlapping class boxes are merged as one unresolved item; separate visible objects remain separate. Online group photos preserve detail up to a 1024-pixel edge, versus 768 pixels for a single item. No learned weights were retrained and no recognition accuracy percentage is claimed.

Open **NAAC Reports** in the main navigation, or its shortcut on the Impact page. The directory lists every university, college and school in the 34-institution catalog, plus saved custom institutions, regardless of the current student profile. Search by name/area, filter the institution type, then choose **Open NAAC report** or use the populated institution selector. First-time visitors can browse reports before creating a student profile.

Each report includes estimated landfill diversion, estimated CO₂, contributing students, items handled, completed quests, activity XP, per-student contributions and CSV downloads. Export a single institution, all institutions, or student contributions. Institutions without saved activity remain listed with **No recorded activity yet**. This means no records in this browser, rather than a claim about the institution's real waste performance. Student rows and institution totals use the same completion ledger. User-reported weights and assumed weights remain distinct. Legacy XP does not count as newly contributed waste or earned activity XP. These are self-reported browser records for reporting support, with no claim of certification or a connected campus-wide service.

EcoLens now uses its own leaf/lens/orbit symbol across the sidebar, mobile header, welcome screen, about card and app icon. Editable vector branding files are in `assets/ecolens-mark.svg`, `assets/ecolens-logo.svg` and `assets/ecolens-brand-guide.md`.

## Public NAAC reports with private personal records

Public report: [EcoLens NAAC Reports](https://ecolens-live-naac.web.app/).

The standalone `naac/` website is the public report view. Its separate Firebase Hosting site publishes only that folder. It reads shared institution totals from the public `ecolensNaacV1/publicInstitutions` node in Firebase Realtime Database. Student names, local profile IDs, photos, XP, corrections, image fingerprints and personal events are never uploaded. Named student rows in the local EcoLens report remain private in that browser.

Settings includes a separate **Public NAAC sharing** section. Enter the public service address, enable **Share anonymous institution totals only**, and save. Only totals for catalog institutions are transmitted. Custom institutions stay private. Offline records remain local and can sync after reconnection. The public page can be read without a student profile or publishing token.

A Firebase anonymous sharing identity and increasing request revision stay under separate browser-storage keys and are excluded from the JSON progress backup. The identity is created only after opting in; public visitors do not sign in. Each browser replaces its own previous totals; retries do not add them again. Private database contributions and global revision markers can be read only by their owner. Atomic updates and security rules prevent a delayed request from undoing a newer update or removal. Turning sharing off removes that browser's contribution when connected; failed removal stays queued and can be retried by saving again. Restoring a backup turns public sharing off until enabled again. Copying the same progress backup to several devices and opting in on each can count those records more than once; this is not a verified student identity service.

Public values remain self-reported estimates. Contributing-profile counts are not verified unique students across devices, and this is reporting support rather than a certified NAAC waste audit.

The Firebase integration uses the **Spark** plan, Firebase Hosting, Realtime Database and anonymous Authentication. It has no Cloud Functions, Cloud Run, App Hosting, Cloud Storage or billing setup. No payment method is needed on Spark. If free limits are reached, the affected service can become unavailable; this build never enables paid billing. [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Firebase pricing](https://firebase.google.com/pricing).

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

The saved tests cover the event ledger, streaks, duplicate rewards, legacy XP, image preprocessing/decoding, uncertainty, cloud request contract, safe server paths, origin checks, error sanitization and persistent quotas. Additional implementation QA exercised the translated interface and upcycling journey in a DOM harness, and ran the real FP32 model through the bundled WebAssembly runtime.

No accuracy percentage has been measured on a held-out campus photo set, and live cloud analysis needs a fresh configured key. Graphical browser, actual camera, phone performance and full service-worker disconnect/reload checks should be run on the presentation device; the in-app preview could not reach the local test server in this environment.

## Project layout

The HTML loads `bootstrap.js` and the complete generated interface under `releases/naac-v9/`. New release paths bypass older service-worker caches that could otherwise mix a new page with old translations/scripts. The worker downloads a complete interface before activating it; online interface files are refreshed, while unchanged model weights keep their existing cache. Saved profiles and progress are not cleared. Offline readiness requires both the interface and model pack.

`npm start` prepares the generated interface automatically before serving. After editing source files for a static preview, run `npm run build`; the generated release files are also included in this source archive. When shipping a later interface release, use a new release directory/version consistently in the builder, bootstrap, HTML and worker.

`index.html`, `styles.css`, `app.js` form the interface. `data.js` contains translations, routes, institutions and tutorials. `core.js` owns the ledger. `inference.js` owns model processing; `scan-flow.js` coordinates cancellation, previews and online fallback; `media.js` handles camera preferences and photo decoding; `report.js` builds campus contribution CSV files. `sw.js` caches the offline app. `server.mjs` and `cloudflare-worker.mjs` provide optional protected online analysis. `vendor/` and `models/` contain local runtime assets. Original branding and design contributions are retained in `assets/` and `design/`.

Original project lead: Kazi Mustafijur Rahaman. Original UI/UX design: Anisha Aktar. Original systems/flowchart design: Koyel Basu.

Third-party runtime and model sources are documented in `THIRD_PARTY_NOTICES.md`.

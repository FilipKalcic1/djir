# Djir — Code Review (baseline)

> **Scope:** the whole repository as received on 2026-09-28: mobile app, API routes, shared logic, ML platform, tooling and docs.
> **Purpose:** find what is broken *before* building anything new. Every item below is fixed, or deferred for a stated reason, in the [Build Plan](BUILD_PLAN.md).
> Line numbers refer to that baseline snapshot.

## Verdict — 3 / 10

The product idea, the design system and the ML platform's structure are strong. The weak part is the **money path**. No API route checks who is calling. The client chooses the price. A ride is written as "paid" before any payment succeeds. Every ML price is computed for the wrong hour of the day. None of this is visible in a demo, which is why it survived: there are no tests to catch it, and lint fails on a clean checkout.

| Area | Grade | Why it is not a 10 | What a 10 looks like |
| --- | :-: | --- | --- |
| API routes & payments | **2** | No authentication. Identity, amount and payment status are all taken from the client. An unused Stripe ephemeral key is handed out for any email address. | Every route authenticates the caller. Identity and money come from server-side truth. Bad input gets a 4xx. Every branch is tested. |
| Client screens & flows | **4** | The happy path works, but the payment sheet can hang, drivers move between screens, a user can be charged twice, and auth has dead ends. | Every flow state (loading, empty, error, success) is handled. Data never changes under the user. The screens match the Figma. |
| Shared logic (`lib/`, `store/`, `types/`) | **4** | Hours are read in the wrong timezone. HTTP errors are swallowed. The "agrees to the cent" claim is false. The types do not match the wire format. | Pure, tested functions. Timezone-correct. Parity with Python proven by a golden test. Types match the data. |
| ML platform | **5** | Clean package, and the metrics reproduce. But serving uses UTC hours, the Databricks path crashes at training, the dependencies are unpinned, and some doc claims are unbacked. | Runs end-to-end on the documented path. Serving is validated, pinned and tested. Every claim is backed by a number or a test. |
| Tooling & docs | **4** | Lint fails (CRLF plus 24 real issues). No tests, and `npm test` never exits. The docs describe features that do not exist. | Typecheck, lint and tests run green in CI. Every README claim matches the code. |

## Status after v1.1 (2026-09-29)

This review is the baseline and is not rewritten. The status of each finding lives in [Build Plan Appendix A](BUILD_PLAN.md#appendix-a--every-finding-owner--proof-type--proof--status), which names its proof and the pass that last checked it; where Appendix A and this summary differ, Appendix A is right:

| Outcome | Findings | How it is proven |
| --- | --- | --- |
| **Fixed, proven by a test** | every finding not listed below | A Jest test titled with the R-id, or a pytest `test_rNN_…` function. `__tests__/meta/rid-map.test.ts` fails if one goes missing. |
| **Fixed, proven by a command** | R29, R42, R44, R49, R50, R54–R58, R60, R66–R68, R70 | A command with its expected output, re-run on each pass. |
| **Deferred, with a reason** | R23 live weather, R31 Clerk upgrade, R62 surge recalibration, R63 zone skew, R65 notebook bootstrap, R72 data contract, R73 key proxy, R77 champion gating | [Plan §11](BUILD_PLAN.md#11-not-now-and-what-it-would-take) says what each would take. |

**The critical findings, R01–R11, have red → green evidence.** `npm run mutants` puts each bug back into the v1.1 code and requires the tests titled with its R-id to fail; plan §10 records the latest run and the tree it ran on.

The measured checks from the table below, re-run on v1.1. The table records outcomes; how many tests ran, the coverage and the machine of each run are in [plan §10](BUILD_PLAN.md#10-iteration-log), which every pass updates.

| Check | Baseline | v1.1 |
| --- | --- | --- |
| `tsc --noEmit` | ✅ 0 errors | ✅ 0 errors |
| `eslint` | ❌ 3,209 problems | ✅ 0 problems, with the layer rules of plan §8 added |
| Tests | ❌ none | ✅ both Jest projects (server with PGlite for SQL, client with Testing Library) and the pytest suite pass, with every coverage threshold in `jest.config.js` met; the current counts are in [plan §10](BUILD_PLAN.md#10-iteration-log) |
| TS ↔ Python pricing parity | ❌ 215 of 5,000 fares off by €0.01 | ✅ 442 golden trips (30 of them straddling the DST switches, 12 with an ETA on a rounding tie) plus 30 rounding cases, equal to the cent |
| Zagreb 08:15 rush-hour request | ❌ scored as hour 6 | ✅ hour 8 on both sides, tested under `TZ=America/Los_Angeles` |
| Loading the committed models | ⚠️ 11 version warnings | ✅ no warnings, and `pytest.ini` turns one into an error |
| `npm ls i npm` | ⚠️ accidental `npm` dependency | ✅ empty; `npx expo install --check` is clean |

## How this review was done

1. **Five independent reviewers**, one per area, read every file in their area.
2. **Adversarial verification.** A separate verifier got each area's findings and was told to *refute* them. **95 of 96 were confirmed and 1 was refuted.** About 40 severities were corrected, most of them downgraded.
3. **Completeness critic.** A final agent searched for cross-cutting defects the others missed (see [Critic](#completeness-critic)).
4. **Measured, not guessed:**

| Check | Result |
| --- | --- |
| `tsc --noEmit` (strict) | ✅ 0 errors |
| `eslint` | ❌ 3,209 problems: 3,185 CRLF artefacts, 16 prettier errors, 8 hook or unused-var warnings |
| Tests | ❌ none exist, and `jest --watchAll` never exits in CI |
| TS ↔ Python pricing parity, 5,000 random trips | ❌ 215 fares off by €0.01 (4.3%), 34 ETAs off by 0.1 min |
| Timezone: a Zagreb 08:15 rush-hour request sent the way the app sends it | ❌ scored as `hour_of_day = 6`, `is_rush_hour = 0` |
| Loading the committed model artifacts | ⚠️ loads, with 11 `InconsistentVersionWarning`s (pickled with sklearn 1.9.0, requirements say `>=1.4`) |
| `npm audit --omit=dev` | ⚠️ 108 advisories. Most are transitive through Expo SDK 51; 29 come from an accidental `npm` dependency |

---

## Critical

**R01 — No API route authenticates the caller; ride history is readable for any user id.**
`app/(api)/ride/[id]+api.ts:36`, `lib/fetch.ts:5` · *found by API-01, LIB-03*
No route verifies a Clerk session, and the client never sends one. `GET /(api)/ride/<clerk id>` returns any user's full history, including home and work coordinates to 7 decimals. Clerk ids are identifiers, not secrets.
**Fix:** verify the session JWT on the server, take the user id from the token, and return 403 when the path id differs.

**R02 — Stripe `/create` looks up a customer by a client-supplied email and returns that customer's ephemeral key.**
`app/(api)/(stripe)/create+api.ts:16` · *API-03*
The ephemeral key is never used by the app. Together with the public publishable key, it lets anyone list and detach a victim's saved cards.
**Fix:** tie the Stripe customer to the authenticated Clerk user (`metadata.clerk_user_id`), and stop minting ephemeral keys.

**R03 — Stripe `/pay` attaches any payment method to any customer and confirms any PaymentIntent.**
`app/(api)/(stripe)/pay+api.ts:18` · *API-04*
There is no ownership check. Combined with R02, a third party can trigger a charge on a victim's saved card.
**Fix:** delete `/pay`. Create and confirm the PaymentIntent in one authenticated call.

**R04 — The client chooses the price.**
`app/(api)/(stripe)/create+api.ts:37` · *API-05*
`amount` is read from the request body. A modified client pays €0.50 for any ride.
**Fix:** re-quote on the server with the same function `/predict-price` uses. Reject a stale client price with 409.

**R05 — A ride is saved as "paid" before the payment completes.**
`components/Payment.tsx:90`, `app/(api)/(stripe)/pay+api.ts:27` · *CLIENT-01, API-06*
A 3-D Secure card returns `requires_action`, and the ride row is inserted as `paid` anyway. If the user then cancels the challenge, history shows a paid ride with no money captured. The reverse also happens: when the ride insert fails *after* the charge, the user still sees "Booking placed successfully" (see R07).
**Fix:** once the sheet reports success, the server creates the ride from the **verified PaymentIntent**: it checks the owner and the status, takes the amount from Stripe, and uses the PaymentIntent id as an idempotency key.

## High

| ID | Defect | Where | Found by | Fix |
| --- | --- | --- | --- | --- |
| R06 | **Every price uses the wrong hour.** The app sends UTC `toISOString()`. FastAPI reads the UTC hour, and the fallback reads the server's `getHours()`. Measured: 08:15 CEST is priced €5.75 instead of €7.70. | `serving/app.py:101`, `lib/pricing.ts:121` | API-08, LIB-02, ML-01, CFG-01 | Derive hour and weekday in **Europe/Zagreb** on both sides. The TS clock is dependency-free and matches `zoneinfo` at all 192,864 half-hour instants from 2020 to 2030. |
| R07 | `fetchAPI` builds `new Error(...)` but never throws it, so every 4xx or 5xx is treated as success. | `lib/fetch.ts:7` | API-09, LIB-01 | Throw an `ApiError` that carries the status and the server message. |
| R08 | `/ride/create` inserts `user_id`, `fare_price`, `payment_status` and `driver_id` straight from the body. | `app/(api)/ride/create+api.ts:6` | API-02 | Build the ride from the verified PaymentIntent (see R05). |
| R09 | The payment sheet spins forever on a declined card or any API error, because `confirmHandler` has no failure path. | `components/Payment.tsx:60` | CLIENT-02, API-10 | Wrap the handler and always call `intentCreationCallback({ error })`. |
| R10 | Google sign-in succeeds but never navigates home. | `components/OAuth.tsx:20` | CLIENT-07 | `router.replace` home on success, and show a guarded error message. |
| R11 | Databricks notebooks 05 and 06 crash with `KeyError: 'payment_status'`, because notebook 04 drops the column. | `notebooks/04_feature_engineering.py:59` | ML-02 | Keep `payment_status` in the feature table. |

## Medium

| ID | Defect | Where | Found by |
| --- | --- | --- | --- |
| R12 | Every `Map` mount re-randomises driver positions, so the selected driver's position, ETA and price change between screens. | `components/Map.tsx:27`, `lib/map.ts:13` | CLIENT-03 |
| R13 | "Select Ride" works with no driver selected, and book-ride then renders `€undefined`. | `app/(root)/confirm-ride.tsx:28` | CLIENT-04 |
| R14 | "Pickup Time" shows trip time *plus* the pickup leg (a driver 1 min away shows "25 min"). | `app/(root)/book-ride.tsx:65`, `lib/pricing.ts:223` | CLIENT-05, LIB-11 |
| R15 | A wrong OTP closes the verification modal and hides the error, so the user cannot retry. | `app/(auth)/sign-up.tsx:133` | CLIENT-06 |
| R16 | Double charge: "Confirm Ride" stays active after success, and `router.push` keeps the paid screen on the back stack. | `components/Payment.tsx:136,154` | CLIENT-08, CLIENT-14 |
| R17 | `fare_price` is stored in **cents** in a euro `NUMERIC(10,2)` column (€7.73 → 773.00). | `components/Payment.tsx:104` | API-07, CLIENT-09, CFG-14 |
| R18 | Quotes have no timeout on the client or the server, and a slow response for an old destination overwrites a newer one. | `lib/pricing.ts:147`, `predict-price+api.ts:39` | API-11, LIB-05, CLIENT-10 |
| R19 | An empty reverse-geocode result or denied location permission leaves the home map spinning forever. | `app/(root)/(tabs)/home.tsx:61` | CLIENT-11, LIB-13 |
| R20 | Auth handlers read `err.errors[0]` unguarded, so network errors fail silently, and in OAuth the handler itself throws. | `sign-in.tsx:38`, `lib/auth.ts:69` | CLIENT-12, LIB-06 |
| R21 | The sign-up "Name" field is never sent to Clerk. | `app/(auth)/sign-up.tsx:31` | CLIENT-13 |
| R22 | The first tap on a place suggestion is swallowed (the sheet has no `keyboardShouldPersistTaps`). | `components/RideLayout.tsx:61` | CLIENT-16 |
| R23 | The app always quotes `weather = "clear"`, so condition-aware pricing is never used. | `components/Map.tsx:47` | CLIENT-18 |
| R24 | Docs claim things the code doesn't do: Apple Pay, Geoapify driver positions, turn-by-turn directions, Databricks Model Serving as `ML_ENDPOINT_URL`, and FastAPI loading `@champion`. | `README.md`, `ml-platform/README.md:45` | CLIENT-19, CFG-09, CFG-10, ML-12, API-13 |
| R25 | "Verified to agree to the cent" is false. The cause is that `features.py` rounds distance to 3 dp and TS does not. Python's half-even `round()` is a second, latent source of difference. | `lib/pricing.ts:123` | LIB-04, ML-07, CFG-07 |
| R26 | Serving dependencies are unpinned (`>=`) while the pickles need sklearn 1.9.0 exactly. | `serving/requirements.txt:4` | ML-04 |
| R27 | No coordinate or service-area validation. A pickup in Split is quoted €224; `lat=999` is accepted. | `serving/app.py:77`, `predict-price+api.ts:24` | ML-06, API-12 |
| R28 | The ETA model (MAE 3.18) is slightly *worse* than the informed heuristic the app already ships (3.12), but the docs only compare it to a flat-speed baseline. | `djir_ml/train.py:98` | ML-08 |
| R29 | Notebook 07's "free-tier export" runs *after* endpoint creation, so it is unreachable when serving is unavailable. | `notebooks/07_register_and_serve.py:94` | ML-11 |
| R30 | Every notebook needs `xgboost` (the package `__init__` imports eagerly), and nothing installs it. | `djir_ml/__init__.py:9` | ML-03 |
| R31 | `@clerk/clerk-expo` 2.1.0 bundles `clerk-js` 5.14.0, which is in the range of GHSA-3mm3-wfpv-q85g (≤ 5.88.0). | `package.json:18` | CFG-06 |
| R32 | The README gallery shows Figma mockups of features that did not exist ("Go Track", live tracking). | `README.md:210` | CFG-08 |
| R33 | API routes are hard-wired to the origin `https://djir.app/`, and there is no deployment note. | `app.json:33` | CFG-11 |
| R34 | No Google Maps key is configured for Android builds, so the map crashes in dev and production builds. | `app.json:18` | CFG-12 |

## Low

| ID | Defect | Found by |
| --- | --- | --- |
| R35 | `predict-price`: malformed JSON gives a 500, an invalid `when` is silently priced off-peak, and `weather: "toString"` returns `null` fares. | API-12, LIB-10 |
| R36 | Serving: an invalid `when` gives a 500 instead of a 422, and `"Rain"` is silently priced as clear. | ML-05 |
| R37 | `POST /user` is unauthenticated and writes a table that nothing reads. | API-14 |
| R38 | The history SQL selects a stray `'driver'` literal column, and the `Ride` type doesn't match the wire data (NUMERIC arrives as a string, `ride_id` is missing). | API-15, LIB-07 |
| R39 | Schema: the seed is not idempotent, there are no indexes, and timestamps are `TIMESTAMP` without a time zone. | API-16 |
| R40 | `useFetch` fires for `/ride/undefined`, has no abort, and will loop on inline `options`. | LIB-12 |
| R41 | `formatTime(12.4)` returns `"12.4 min"` and `formatTime(undefined)` returns `"undefined min"`. | LIB-09 |
| R42 | `sortRides` is dead code and wrong in three ways. | LIB-08 |
| R43 | The default map region is San Francisco, and pickup equal to destination gives a zero-span region. | LIB-13 |
| R44 | Unused icons and exports, a `$` icon beside € prices, and an un-awaited `SecureStore` write. | LIB-14 |
| R45 | `DriverCard` shows a hard-coded ★4 for every driver. | CLIENT-17 |
| R46 | RideCard's "Date & Time" row shows the trip duration, not a time of day. | CLIENT-20 |
| R47 | Home and Rides ignore fetch errors and never refetch. | CLIENT-21 |
| R48 | `RideLayout` switches its scroll container on the magic title `"Choose a Rider"`. | CLIENT-22 |
| R49 | Tabs `initialRouteName="index"` names a route that doesn't exist. | CLIENT-23 |
| R50 | 30 Tailwind classes are no-ops (`font-JakartaRegular` ×17, `text-md` ×13). | CLIENT-24, CFG-15 |
| R51 | The map only uses `initialRegion`, so a changed route is never re-framed. | CLIENT-25 |
| R52 | Sign-out isn't awaited and stores aren't reset, so the next user sees the previous user's destination. | CLIENT-26 |
| R53 | No auth guard on the `(root)` group, so deep links reach booking while signed out. | CLIENT-15 |
| R54 | Accidental dependencies `i` and `npm` (15 MB, 29 advisories), plus three never-imported packages. | CFG-04, CFG-05, CLIENT-27 |
| R55 | Lint fails on Windows because of CRLF, and there is no `.gitattributes`. | CFG-02, CLIENT-28 |
| R56 | No tests, `npm test` never exits, and there is no typecheck script and no CI. | CFG-03 |
| R57 | Expo template leftovers: `reset-project.js` and the `react-logo*` assets. | CFG-16 |
| R58 | `react-native` and `@stripe/stripe-react-native` versions are ahead of what SDK 51 expects. | CFG-17 |
| R59 | `userInterfaceStyle: "automatic"` on a light-only UI. | CFG-18 |
| R60 | `.gitignore` misses `.env*.local`. | CFG-19 |
| R61 | README gallery rows are padded with empty cells. | CFG-20 |
| R62 | The fallback surge is miscalibrated against the data (Friday nights too low, Sunday nights too high). | ML-09 |
| R63 | Train/serve zone skew: 6.5% of pickups have a stored zone that differs from `nearest_zone(coords)`. | ML-10 |
| R64 | A corrupt model artifact crashes serving at import, and a half-missing pair silently disables ML. | ML-13 |
| R65 | Notebook path auto-detection is copy-pasted into 7 notebooks. | ML-14 |
| R66 | `run_local.py` writes relative to the current working directory, so serving can keep using stale models. | ML-16 |
| R67 | Docker: no `.dockerignore` (508 MB build context), runs as root, no healthcheck. | ML-17 |
| R68 | The dashboard's headline `avg_surge` is an unweighted mean of daily means. | ML-18 |

## Completeness critic

A final agent was given the list above and told to find only what it **missed**. It graded the whole project **3/10** on its own, and added:

| ID | Sev. | Defect | Where |
| --- | --- | --- | --- |
| R69 | Med | No trip-distance cap. Places search is worldwide and the heuristic is unbounded, so a "ride" Zagreb → Split quotes and charges **€332.46**. | `GoogleTextInput.tsx:62`, `predict-price+api.ts:62` |
| R70 | Med | The web build cannot bundle (`react-native-maps` has no web platform), so `npx expo export`, which is how the API routes are deployed, fails too. | `README.md:19`, `components/Map.tsx:3` |
| R71 | Med | The Payment Sheet offers every Dashboard method (iDEAL, Klarna…), but the server only supports attachable, no-redirect methods, so the sheet hangs. | `components/Payment.tsx:49` |
| R72 | Med | Docs say "on real data, skip the generator; nothing else changes", but the app's `rides` table lacks every column Silver needs. | `ml-platform/README.md:72` |
| R73 | Med | The Google Places and Directions web-service keys ship in the JS bundle and can't be app-restricted. | `GoogleTextInput.tsx:7` |
| R74 | Med | Core controls are unusable with a screen reader: icon buttons have no labels, and driver selection is shown by colour only (1.1:1 contrast). | `RideLayout.tsx:29`, `DriverCard.tsx:10` |
| R75 | Low | `initPaymentSheet` errors are discarded, so users see "not initialized" instead of the cause. | `components/Payment.tsx:121` |
| R76 | Low | `created_at` is `TIMESTAMP` without a time zone, so ride dates shift with the API server's timezone (a ride at 00:30 CEST shows as the previous day). | `schema.sql:37` |
| R77 | Low | Training notebooks promote whatever they just trained to `@champion`, with no comparison against the incumbent. | `notebooks/05_train_eta.py:88` |

## Refuted during verification

- **ML-15:** "longitude jitter is 43% *wider* than documented." The verifier measured it: it is 30% *narrower* (0.42 km vs 0.6 km), so the claimed failure goes the other way. It is harmless.
- The client reviewer withdrew two suspicions before reporting: OAuth "two alerts" (Clerk errors carry no `.code`) and a tab-order bug (Expo falls back to the first tab).

## What is genuinely good

- **All SQL is parameterised** through Neon tagged templates, so there is no injection surface.
- **The ML package** has one source of truth (`config.py`), clear docstrings and an honest evaluation setup (time-based split, naive baselines). The committed metrics **reproduce exactly** (49,944 / 12,485 split).
- **The pricing arithmetic is ported correctly.** Constants, haversine, the weekday conversion and the surge steps all match. The only gap is rounding (R25).
- **TypeScript strict mode is clean**, and the design system (NativeWind tokens, Plus Jakarta Sans, Figma screens) is coherent.

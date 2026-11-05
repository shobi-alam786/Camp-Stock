# Camp Stock Inventory — Audit & Repair Report

Legend: **Done** = code changed · **Tested** = executed here with a visible result · **Not tested** = no build/run was possible · **Open** = not done

## 1. Environment limits (why most items are "Not tested")
No network, no Gradle/Android SDK, no Rust/Tauri, no `node_modules`. Only the pure TypeScript logic could be run (transpiled with a local TypeScript 6.0.3 and executed with Node 22). **No Android build, Windows build, Kobo submission or GitHub Actions run has been observed.**

## 2. Architecture (inspected)
- Windows: React + Vite + TypeScript in a Tauri shell (`src-tauri`); local store = IndexedDB (`src/services/db.ts`); Kobo via Tauri HTTP plugin.
- Android: Kotlin + Jetpack Compose + Room + WorkManager (`android-camp-stock`); Kobo via HttpURLConnection.
- **No shared code and no shared database.** Each platform has its own ledger and its own Kobo client. Stock numbers on Windows and Android agree only if both contain the same transactions; today only Android can pull from Kobo (Restore Ledger), Windows cannot (parser exists, never called).

## 3. Findings and status
| # | Where | Problem | Fix | Status |
|---|-------|---------|-----|--------|
| 1 | Windows `App.tsx` Sync button | Marked every record SYNCED with no network call | Real per-record submit, real result counts and error text | Done · Not tested |
| 2 | Windows `koboClient.ts` | Test Connection and submit returned fake success outside Tauri; fake ID from `Date.now()` | Honest failure; real status handling; id_string check | Done · Not tested |
| 3 | Windows + Android | Asset UID sent as XML root instead of form `id_string` → Kobo would reject | Separate Form ID field in both apps | Done · Not tested |
| 4 | Windows Settings | Save did nothing | Persisted (localStorage) | Done · Not tested |
| 5 | Android Settings | "Device location" never used; "saved securely" text untrue | Wired to startup location; text corrected | Done · Not tested |
| 6 | Android Settings/menu | Settings unreachable: menu not scrollable, keyboard covered fields | Scrollable menu, `imePadding` | Done · Not tested |
| 7 | Windows physical counts | Never saved, never produced an adjustment | Persisted; Create adjustment / Dismiss; stale-stock block | Done · Not tested |
| 8 | Android counts | Stale count still allowed an adjustment | Button disabled ("Recount required"); count date used | Done · Not tested |
| 9 | Dashboards | Many tiles | 4 tiles; one shared icon list for menu + tiles (Android); Windows tiles use nav icons | Done · Not tested |
| 10 | Android Sync Centre | Failure reason never shown | "Why records did not sync" card + Last error | Done · Not tested |
| 11 | Opening balance 18-10-2026 | Needed in both apps | Idempotent delta import, units confirmed | Done · **Tested** (`openingBalance.test.ts`: 40 lines, second run adds nothing) |
| 12 | CI | Android workflow never ran tests; Windows ran only 3 of 5 tests | Added `testDebugUnitTest`; added missing TS tests | Done · Not tested |
| 13 | Existing TS tests | — | inventory, koboXml, drrReport, dailyReport, catalogueOps | **Tested: all 5 pass** (+ new opening-balance test) |

## 4. Open items (not done) — need your decision or a build environment
1. **Damaged returns.** The data model has one RETURN type; there is no damaged quantity, so damaged stock cannot be kept apart from usable stock. Needs: damaged-quantity field, a separate damaged ledger, and a new Kobo field/choice. *Decision needed:* add a `DAMAGED_RETURN` line type (recommended, appends to the form) — confirm and I will implement in both apps and the XLSForm.
2. **Register parity.** Receiving has supplier, PO, GRN, staff, notes. Missing vs the paper register: **vehicle number** and a separate "received by". Dispatch has block/MRF but no "issued by"/"received by" acknowledgement. These need new Kobo fields.
3. **Historical balances** (balance as of each transaction) and a register-style reconciliation view: not built.
4. **Duplicate submission on Windows** after a network exception: record is marked FAILED and a retry can duplicate. Android already verifies against Kobo before retrying; Windows does not (excluded at your request).
5. **Windows cannot pull from Kobo**, and the two apps use separate databases. Needs a Windows "restore/sync from Kobo" (parser exists).
6. **Audit log / corrections:** no ordinary edit of past transactions exists (good), but there is no correction/reversal workflow or change history.
7. **Atomicity** of Android transaction writes (Room `@Transaction`) and **database migrations** were not verified.
8. **Security:** Android stores the Kobo token in plain SharedPreferences; Windows in localStorage. Encrypted storage (Android Keystore / OS credential store) is recommended.
9. **Android CI builds a debug APK**, not release; no signed release artifact is produced without your keystore secrets.
10. **Reports/exports:** DRR and daily report logic tests pass; other screens were not audited line by line.

## 5. How to verify after building
1. `npm install && npm test-equivalent`: run the six `npx tsx src/**/*.test.ts` files.
2. `cd android-camp-stock && ./gradlew testDebugUnitTest assembleDebug`.
3. Deploy `kobo-forms/Camp-Stock-Transactions.xlsx` in Kobo; set Asset UID, Form ID (`camp_stock_transactions`) and token in Settings; submit one record; confirm an `add-submission` entry appears in Kobo → Settings → Activity.

## 6. Follow-up implementation after v7 audit (source edits; builds still not run)
- Added optional paper-register fields to the Windows and Android transaction models: vehicle number, received by, issued by, and dispatch acknowledgement.
- Added the receiving vehicle/receiver inputs in both apps and dispatch issuer/acknowledgement inputs in both apps.
- Added a per-material damaged quantity for return lines in both apps, validated that it is not negative and does not exceed total returned quantity, and changed usable-stock calculations to add only `returned - damaged`.
- Added `vehicle_number`, `received_by`, `issued_by`, `acknowledgement_by`, and repeat-line `damaged_quantity` to the OpenRosa XML mapping and parser.
- Appended the optional fields to the XLSForm survey and updated the workbook settings version to 1.3. **Before deploying this XLSForm, inspect and validate it in KoboToolbox; a changed form version/schema may require redeployment and must not overwrite a live form without a backup.**
- Added a Windows Settings action to fetch up to 1,000 Kobo records, import missing records, and reconcile matching local UUIDs as synced. This is not full pagination and has not been tested against a live Kobo instance.
- Windows network exceptions now become `OUTCOME_UNKNOWN` instead of ordinary `FAILED`, so the standard sync button does not blindly retry them. The Restore from Kobo action can reconcile matching UUIDs. Remote query semantics remain unverified on a live server.
- Added a pure TypeScript historical-balance helper and test for an as-of date. The helper is not yet connected to a dedicated register-style UI.
- Android Room database version advanced to 4 with a non-destructive migration adding the new fields.
- Android CI now requests `assembleRelease` and uploads the unsigned release APK artifact when the build succeeds. It is only install-over-existing-app compatible when configured with the same signing key; verify signing secrets and artifact path in GitHub Actions.

## 7. Still open after these edits
- No Android or Windows build was run in this environment. The local TypeScript compiler check is blocked because project dependencies (including `vite/client`) are not installed; no claim of a passing build is made.
- No live Kobo submission, restore, duplicate lookup, or deployed XLSForm validation was run.
- Windows restore currently reads the first 1,000 records only; pagination is still needed for larger datasets.
- The historical-balance helper is not yet exposed in a register-style reconciliation screen.
- No user-facing correction/reversal and audit-history workflow has been implemented.
- Kobo tokens remain in unencrypted localStorage on Windows and SharedPreferences on Android. This requires platform-specific secure storage and cannot be considered fixed.
- Android Room atomicity/migration behavior still needs build/runtime verification.
- Cross-device data remains separate except through Kobo; the Windows restore action is one-way and bounded to the first 1,000 records.

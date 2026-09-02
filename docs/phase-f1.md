# F.1 — Kanban profissional

## Architecture and rollout

Same `leads`, stages, `lead_notes`, Phase D `assign_lead`, and Phase C RLS. No new lead database, plan or entitlement. Existing `crm.pipeline` / `crm.history` are enabled in all three plans; F.1 introduces no extra commercial restriction. No Realtime subscription; canonical mutation responses update a single store, and explicit refresh obtains current team changes. Cards render in batches of 50 per column with full loaded counts. Keyset requests avoid the PostgREST row limit. Only one request per lead may mutate at a time; refresh cannot replace a pending optimistic update. Navigation uses detached mounts to reject stale render completions.

The stage PATCH contains only `stage` and filters by ID, active organization and exact `updated_at`. RLS is still authoritative. Zero returned rows means a conflict, not success. Failed/uncertain responses restore the previous snapshot; refresh before retrying. Notes are not optimistically cleared: in ambiguous network failures check history before resending. No automatic note retries.

Migration: `20260830100000_phase_f1_kanban_audit.sql`, mirrored in `supabase/20260830_10_phase_f1_kanban_audit.sql`. Adds stage/note audit triggers, a history index, `list_lead_activity`, and `kanban_access`. Uses existing audit storage without adding direct table access. Only note ID is copied to audit, never note text. History is restricted to the current lead's authorized readers, including assigned agents. No historical activity is invented/backfilled.

Replaces `assign_lead`, `list_team_members` and `list_team_audit` preserving their signatures and Phase D rules, but explicitly rejects NULL membership roles. Legacy `IF role NOT IN (...)` does not reject SQL NULL: disabled/non-member callers must fail closed. The existing audit RPC cannot bypass the new scoped history. Stage RLS and all protected-column grants remain unchanged. The new capability RPC validates active membership freshly; it is not an authorization substitute for the mutation endpoint.

The production migration was applied through the controlled linked Supabase rollout on 2026-09-02, after the complete local validation and a dry-run that listed only `20260830100000_phase_f1_kanban_audit.sql`. Migration history was checked immediately afterwards. No production fixtures, secrets or Edge Functions were changed.

No repository CI workflow or database auto-deployment configuration was found. Existing main pushes publish static files. The separate F.7 audit subsequently removed the nullable-role fail-open condition through a fail-closed membership sentinel, with PostgreSQL regressions for disabled and absent memberships. Do not run resets or test fixtures on production.

## Verification

`node --test tests/phase-f1/kanban.test.mjs` tests store behavior and real frontend adapters (mock transport), including rollback, request serialization, compare-and-set, filters, pagination and denied capability.

`tests/phase-f1/database.test.mjs` runs real PostgreSQL in WASM via `@electric-sql/pglite` **0.5.8**, with pgcrypto. It reconstructs the complete migration chain in memory, reapplies F.1, and checks owner/manager/agent/disabled/cross-tenant permissions, RLS, grants, audit and assignment. It has no network client or database URL. Minimal local `auth.users` / `auth.uid()` scaffolding supplies JWT identity; this is not GoTrue, PostgREST or Edge Function regression. Closing the database discards all fixtures.

Install the pinned package in an isolated temporary directory (not frontend dependencies), set `PGLITE_PACKAGE` to the package root, then run `scripts/test-phase-f1.ps1`. The script explicitly warns when PostgreSQL tests are not configured. `validate-local.ps1` runs F.1 before the normal C/D/E/Property Ad Docker suites. A Docker infrastructure failure is not a passing regression.

## UX

Six original stages, counts, name/phone/property search (180 ms debounce), combined stage/origin/responsible/unassigned filters, clear and refresh. Cards show only available facts, an explicit unassigned indicator, and a detail button. Drag handles support mouse; native stage selectors are the keyboard/touch alternative. Quick detail reuses the existing modal and note-history components, adds scoped activity, valid team assignment, phone links and access to the existing editor. No advanced agenda, scoring or automation.

Drag uses Pointer Events with temporary document listeners, an 8 px threshold, target highlighting and horizontal edge scrolling. Escape, pointer cancel, window blur and detached cards cancel safely. Only handles disable touch scrolling. The quick editor preserves unchanged appointment timestamps exactly and serializes edited local times with an explicit UTC timezone.

## Execution evidence (2026-08-30)

- F.1: 34 frontend/interaction tests + 24 embedded PostgreSQL tests = 58 passed, zero failures.
- Public site: 11 passed. JavaScript syntax, PowerShell parser and migration parity passed.
- All 21 migrations rebuilt an empty embedded database; F.1 reapplied successfully. This is not a full Supabase reset.
- Browser demo: mouse drag, stage selector, refresh, combined phone/origin/assignee filters, note, assignment, existing edit flow, quick detail and responsive 390 px layout checked; no relevant console errors.
- Full `validate-local.ps1` reaches Docker after passing executable tests/syntax checks, then stops because `dockerDesktopLinuxEngine` is absent. C/D/E and Property Ad HTTP regressions were not rerun; historical totals are not claimed as current passing results.
- The only remote schema action for F.1 was the reviewed migration above. No production fixtures, secret changes or Edge Function deployment occurred.

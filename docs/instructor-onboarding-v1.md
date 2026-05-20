Title: Instructor Onboarding v1 — Scheduling, Role Sync, Dashboard Prompt

Summary

- Adds SchedulingSettingsForm to /instructor/onboarding with initial time zone and working hours.
- Adds a placeholder “Connect Google Calendar” card with a disabled button.
- Adds silent role sync via POST /api/instructor/sync-role (idempotent) to ensure Convex role is set to "instructor".
- Adds a banner on /instructor/dashboard prompting “Finish Setting Up Your Profile” when time zone or working hours are missing.

Details

- SchedulingSettingsForm
  - Client component at apps/platform/components/instructor/scheduling-settings-form.tsx
  - Reads IANA time zones where supported, falls back to a small list.
  - Supports multiple intervals per weekday (0–6), validated by zod in the API.
  - Saves via PATCH /api/instructor/settings (Convex mutation: api.instructors.updateInstructorSchedulingSettings).
  - GET /api/instructor/settings returns { timeZone, workingHours } for the current instructor.

- Silent Role Sync
  - apps/platform/components/instructor/ensure-instructor-role.tsx calls POST /api/instructor/sync-role once on mount.
  - apps/platform/app/api/instructor/sync-role/route.ts authenticates with Clerk → Convex and runs api.users.syncUser({ role: "instructor" }).

- Onboarding Page
  - apps/platform/app/instructor/onboarding/page.tsx renders EnsureInstructorRole and the scheduling form.
  - Shows a “Connect Google Calendar” placeholder card with disabled button.
  - Continues to list student onboarding submissions (SQL) for review.

- Dashboard Prompt
  - apps/platform/app/instructor/dashboard/page.tsx computes incomplete profile state when timeZone is missing OR workingHours is empty.
  - Renders a banner with link to /instructor/onboarding.

API & Validation

- apps/platform/app/api/instructor/settings/route.ts
  - GET: Loads instructor via Convex by user id and returns { timeZone, workingHours }.
  - PATCH: zod validates payload, enforces day keys 0–6, updates via Convex mutation with auth checks (admin or self).

- Naming Policy
  - Replaced a lingering response field name from mentorTimeZone → instructorTimeZone in instructor availability API.

Reviewer QA

1. Role Sync
   - Sign in as an invited instructor. Visit /instructor/onboarding and confirm one POST /api/instructor/sync-role.
   - Verify Convex users row has role "instructor".

2. Initial Settings Load
   - Call GET /api/instructor/settings. Confirm { timeZone, workingHours } reflect Convex state (null when unset).

3. Save Settings
   - PATCH /api/instructor/settings with a valid timeZone and per-day intervals. Expect 200 and updated values from a subsequent GET.

4. Dashboard Banner
   - With no settings → banner appears with link to onboarding.
   - After saving both → banner disappears.

5. Admin Students API (Regression)
   - GET /api/admin/instructors/:id/students as admin → 200 { students }.
   - Non-admin/unauth → 401/403, not 500.
   - Shape drift → 500 with "Invalid students payload".

6. Naming Check
   - GET /api/instructors/:id/availability now returns instructorTimeZone (not mentorTimeZone).

Out of Scope (Next PR)

- Google Calendar OAuth connect/disconnect routes and token storage. Will wire separately to avoid mixing concerns and to validate ENCRYPTION_KEY and Google OAuth credentials first.

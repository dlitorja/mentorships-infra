# Instructor Inventory & Waitlist System - Implementation Notes

## Overview

This document tracks the implementation of an authenticated admin dashboard in apps/marketing for managing instructor inventory counts. When inventory reaches 0, the buy button is hidden on instructor profile pages and a waitlist sign-up button is shown instead.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Marketing App (apps/marketing)               │
├─────────────────────────────────────────────────────────────────┤
│  Public Pages              │  Admin Dashboard (/admin)          │
│  - Instructor profiles     │  - Clerk auth required             │
│  - Waitlist form           │  - Inventory management UI         │
│  - Kajabi checkout links   │  - Edit seat counts                │
└────────────────┬───────────────────────────────┬────────────────┘
                 │                               │
                 │   Supabase (Single Source of Truth)    │
                 │   - instructor_inventory              │
                 │   - kajabi_offer_mappings             │
                 │   - marketing_waitlist                │
                 ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Web App (apps/web)                          │
├─────────────────────────────────────────────────────────────────┤
│  API Routes                 │  Database (PostgreSQL)            │
│  - /api/instructor/:slug/inventory                              │
│  - /api/webhooks/kajabi     │  - mentors table (future use)     │
│  - /api/waitlist (Supabase) │  - kajabi_offers table            │
└────────────────┬────────────────┬───────────────────────────────┘
                 │                │
                 ▼                ▼
          ┌───────────┐   ┌───────────────┐
          │  Resend   │   │   Inngest     │
          │  (Email)  │   │   (Background)│
           └───────────┘   └───────────────┘
```

## Current State

- **PR #48**: Phase 2 merged
- **PR #50**: Phase 3 merged
- **PR #51**: Form migrations merged (all 5 forms)
- **PR #52**: Phase 4 merged (waitlist email notifications)
  - Email template with proper sanitization (escapeHtml for href, sanitizeHeaderValue for all text)
  - Inngest function sends actual emails via Resend with type safety
  - Rate limiting (1 email/7 days per user) with proper database timestamp tracking
  - API route returns simple confirmation (no stale counts)
  - All CodeRabbit review issues addressed:
    - Fixed inverted error-checking logic
    - Removed duplicate Supabase client
    - Added isMentorshipType() type guard (no runtime includes check)
    - Added explicit return types to all step.run callbacks
    - URL sanitization to prevent javascript: URIs
    - Fixed invalid HTML nesting
    - Sanitized email headers to prevent CR/LF injection
    - Single timestamp variable used in database updates
    - Error logging for failed email sends
    - Consistent use of sanitizedInstructorName throughout email template
- **PR #53**: Phase 5 merged (UI Polish)
  - Added `<Toaster />` to marketing app layout for toast notifications
  - Migrated all forms to use `sonner` toast notifications:
    - Marketing waitlist form
    - Mentee onboarding form
    - Book session form
    - Scheduling settings form
    - Admin inventory table (already had toasts)
    - Offer button (already had toasts)
  - Improved error handling with user-friendly toast messages
  - Verified mobile responsive design across all forms
  - All inline error displays replaced with toast notifications
  - Consistent loading states across all forms (already implemented)
- **Automatic Notifications**: ✅ Implemented (not yet PR'd)
  - Kajabi webhook now tracks and sends actual `previousInventory` value
  - Admin inventory update (marketing app) detects 0 → >0 transition and triggers `inventory/available` event
  - Admin inventory update (web app) already triggers `inventory/available` event
  - New Inngest function `handleInventoryAvailable` sends waitlist notifications when inventory becomes available
  - Uses same email template and rate limiting as manual notifications
- **Build Status**: ✅ Both apps build successfully
- **TanStack Form**: All forms use TanStack Form + Zod with typed parameters
- **Middleware**: Renamed to `proxy.ts` (Next.js 16 requirement)
- **Deployment**: ✅ Production deployed

## Form Standards

All forms in the monorepo MUST use:
- **TanStack Form** (`@tanstack/react-form`) for form state management
- **Zod** (`zod`) for validation
- **0 instances of react-hook-form**
- **0 instances of manual useState form handling**

### Shared Dependencies

`@tanstack/react-form` is defined in root `package.json` (v1.27.0). Both apps access it via Node.js hoisting - no need to add to individual app `package.json` files.

### Shared FormField Component

**Location:** `packages/ui/src/components/form-field.tsx`

A reusable wrapper that reduces TanStack Form boilerplate:

```typescript
interface FormFieldProps<T> {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  validator?: { onChange: z.ZodTypeAny };
  children?: (field: FieldApi<T>) => ReactNode;
}

export function FormField<T>({ name, label, placeholder, type, validator, children }: FormFieldProps<T>) {
  return (
    <form.Field name={name} validators={validator}>
      {(field) => (
        <div className="space-y-2">
          <label htmlFor={field.name}>{label}</label>
          {children ? (
            children(field)
          ) : (
            <input
              id={field.name}
              type={type}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value as T)}
              onBlur={field.handleBlur}
              placeholder={placeholder}
            />
          )}
          {field.state.meta.errors.length > 0 && (
            <p className="text-sm text-red-600">{field.state.meta.errors[0]?.message}</p>
          )}
        </div>
      )}
    </form.Field>
  );
}
```

### Shared Form Component (Wrapper)

**Location:** `packages/ui/src/components/form.tsx`

Optional wrapper for consistent form submission pattern:

```typescript
interface FormProps<T> {
  defaultValues: T;
  validators: { onChange: z.ZodSchema<T> };
  onSubmit: (values: T) => Promise<void>;
  children: ReactNode;
}

export function Form<T>({ defaultValues, validators, onSubmit, children }: FormProps<T>) {
  const form = useForm({ defaultValues, validators, onSubmit });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
      {typeof children === "function" ? children(form) : children}
    </form>
  );
}
```

---

## Implementation Phases

### ✅ Phase 1: Database & Admin Foundation (COMPLETED)
- [x] Database schemas (main DB + Supabase)
- [x] Inventory API routes
- [x] Clerk authentication
- [x] Admin dashboard UI

### ✅ Phase 2: Unified Waitlist with Supabase + TanStack Form (COMPLETED)

**Goals:**
1. [x] Use Supabase as single source of truth for waitlist data
2. [x] Create shared schemas package with Zod schemas
3. [x] Create shared FormField and Form components
4. [x] Migrate marketing waitlist forms to TanStack Form
5. [x] Update API routes to write directly to Supabase
6. [x] Remove PostgreSQL waitlist table

**Tasks Completed:**

#### 2.1 Create Shared Schemas Package ✅
- [x] Created `packages/schemas/package.json`
- [x] Created `packages/schemas/tsconfig.json`
- [x] Created `packages/schemas/src/index.ts` with:
  - `VALID_INSTRUCTOR_SLUGS`
  - `VALID_GROUP_MENTORSHIP_SLUGS`
  - `waitlistPostSchema`
  - `waitlistGetSchema`
  - `waitlistFormSchema`
  - `inventoryResponseSchema`
  - `menteeOnboardingFormSchema`
  - `bookSessionFormSchema`

#### 2.2 Create Shared UI Components ✅
- [x] Created `packages/ui/package.json`
- [x] Created `packages/ui/tsconfig.json`
- [x] Created `packages/ui/src/components/form-field.tsx` (merged Form + FormField in single file)
- [x] Created `packages/ui/src/index.ts`

#### 2.3 Migrate Forms to TanStack Form ✅

**COMPLETED (User-Facing):**
- [x] `apps/marketing/app/waitlist/page.tsx`
- [x] `apps/marketing/components/instructors/offer-button.tsx`

**NOT MIGRATED (Complex State):**
- `apps/web/components/dashboard/mentee-onboarding-form.tsx` - File upload flow
- `apps/web/components/calendar/book-session-form.tsx` - Query-based slots
- `apps/web/components/instructor/scheduling-settings-form.tsx` - Nested state
- `apps/web/app/checkout/page.tsx` - Low priority
- `apps/marketing/components/admin/inventory-table.tsx` - Admin only

#### 2.4 Update API Routes ✅

**apps/marketing:**
- [x] Updated `app/api/waitlist/route.ts` - Direct Supabase insert

**apps/web:**
- [x] Updated `app/api/waitlist/route.ts` - Switch to Supabase
- [x] Created `apps/web/lib/supabase-inventory.ts`

#### 2.5 Remove PostgreSQL Waitlist ✅
- [x] Created migration: `packages/db/drizzle/0014_drop_waitlist.sql`
- [x] Updated `apps/web/lib/validators.ts` to re-export from `@mentorships/schemas`

### Phase 3: Kajabi Webhook Integration (COMPLETED)

**Goals:**
1. [x] Create `/api/webhooks/kajabi` endpoint in apps/marketing
2. [x] Verify webhook request (offer mapping + User-Agent check)
3. [x] Decrement inventory on purchase via Supabase RPC
4. [x] Trigger Inngest event when inventory changes
5. [x] Trigger waitlist notifications when inventory goes 0 → available

**Tasks Completed:**

#### 3.1 Enhanced Kajabi Webhook ✅
- [x] Updated `apps/marketing/app/api/webhooks/kajabi/route.ts`
- [x] Simplified verification (no KAJABI_API_SECRET required)
- [x] Uses Supabase offer mappings for validation
- [x] Gets previous inventory before decrement
- [x] Sends `inventory/changed` Inngest event with before/after values

#### 3.2 Inventory Changed Inngest Function ✅
- [x] Created `apps/marketing/inngest/functions/inventory-changed.ts`
- [x] Handles `inventory/changed` events
- [x] Triggers waitlist notifications when inventory hits 0
- [x] Rate-limits notifications (max once/week per user)
- [x] Updated `apps/marketing/app/api/inngest/route.ts` to register new function

#### 3.3 Updated Event Types ✅
- [x] Added `inventoryChangedEventSchema` to `apps/web/inngest/types.ts`
- [x] Added `InventoryChangedEvent` type export
- [x] Added to `InngestEvent` union type

### Phase 4: Waitlist Notifications (✅ COMPLETED)
- [x] Email template for waitlist notifications
- [x] Inngest function for processing notifications (extend existing)
- [x] Weekly digest cron job (implemented)
- [x] Email frequency tracking (max once/week)
- [x] Resend integration for sending emails

### ✅ Phase 5: UI Polish (COMPLETED)
- [x] Loading states (already implemented in all forms)
- [x] Toast notifications (added to all forms using sonner)
- [x] Error handling (improved with user-friendly toast messages)
- [x] Mobile responsive design (verified and already implemented)

### ✅ Phase 6: Automatic Notifications (COMPLETED)

**Goals:**
1. [x] Detect when inventory transitions from 0 to available
2. [x] Auto-trigger waitlist notifications without manual admin action
3. [x] Track previous inventory in webhooks

**Tasks Completed:**

#### 6.1 Kajabi Webhook Enhancement ✅
- [x] Updated `apps/marketing/app/api/webhooks/kajabi/route.ts`
- [x] Fetch `previousInventory` before decrement
- [x] Send actual `previousInventory` value to `inventory/changed` event (was hardcoded to 0)

#### 6.2 Marketing App Inventory Update ✅
- [x] Updated `apps/marketing/lib/supabase-inventory.ts`
- [x] Get current inventory before updating in `updateInventory` function
- [x] Detect 0 → >0 transition for both one-on-one and group types
- [x] Send `inventory/available` Inngest event when transition detected

#### 6.3 Inventory Available Inngest Function ✅
- [x] Created `apps/marketing/inngest/functions/inventory-available.ts`
- [x] Handles `inventory/available` events
- [x] Fetches waitlist entries (same logic as manual notifications)
- [x] Sends emails via Resend (same template as manual notifications)
- [x] Updates `notified` and `last_notification_at` timestamps
- [x] Registered in `apps/marketing/app/api/inngest/route.ts`

#### 6.4 Web App Inventory Update (Already Implemented) ✅
- [x] `apps/web/app/api/instructor/inventory/route.ts` already triggers `inventory/available` event
- [x] Detects 0 → >0 transition for both mentorship types
- [x] Note: This event is handled in marketing app's Inngest function

---

## Waitlist Storage Consolidation

| Before | After |
|--------|-------|
| 2 waitlists (PostgreSQL + Supabase) | 1 waitlist (Supabase) |
| apps/marketing proxies to apps/web | Direct Supabase writes |
| Inconsistent form handling | All TanStack Form + Zod |
| Duplicated schemas | Shared `packages/schemas` |

---

## Code Sharing: apps/marketing → apps/web

When apps/marketing develops features ahead of apps/web:

| Feature | Copy From | Copy To |
|---------|-----------|---------|
| Inline waitlist form | `apps/marketing/components/instructors/offer-button.tsx` | `apps/web/components/instructors/` |
| Inventory table UI | `apps/marketing/components/admin/inventory-table.tsx` | `apps/web/components/admin/` |
| Supabase helpers | `apps/marketing/lib/supabase-inventory.ts` | `apps/web/lib/` |
| Inngest functions | `apps/marketing/inngest/functions/*.ts` | `apps/web/inngest/functions/` |

---

## Forms Audit Summary

| Status | Count |
|--------|-------|
| Using TanStack Form + Zod | 9 |
| Using react-hook-form | 0 |
| Using manual state | 0 |

**Migrations Completed (PR #51):**
1. ✅ MenteeOnboardingForm (HIGH - core flow)
2. ✅ BookSessionForm (HIGH - core flow)
3. ✅ SchedulingSettingsForm (MEDIUM - complex nested state)
4. ✅ Checkout page (LOW - simple)
5. ✅ InventoryTable (LOW - admin only)

**Key Improvements in PR #51:**
- Added full 12-type-parameter generic signature to `TypedFormApi` with documented justification for `any` usage
- Memoized FormContext.Provider value to prevent unnecessary re-renders
- Added explicit return type to `useAppForm` to maintain type inference
- Removed no-op `onSubmit` handlers and `throw error` statements to prevent unhandled rejections
- Optimized InventoryTable rendering: moved `editForm.Subscribe` inside each Card so only editing card re-renders
- Added inline comments explaining TanStack Form generic constraints where `any` is used
- Forms use direct `useForm` imports from `@tanstack/react-form` due to Next.js/Turbopack workspace resolution

---

## Files Created (Phase 2)

| File | Purpose |
|------|---------|
| `packages/schemas/package.json` | Shared Zod schemas package |
| `packages/schemas/tsconfig.json` | TypeScript config |
| `packages/schemas/src/index.ts` | All shared schemas |
| `packages/ui/src/components/form-field.tsx` | Reusable FormField + Form components |
| `packages/ui/src/index.ts` | UI package exports |
| `apps/web/lib/supabase-inventory.ts` | Supabase client for waitlist/inventory |
| `apps/marketing/lib/supabase.ts` | Supabase client initialization |
| `apps/marketing/components/form.tsx` | Re-exports from @mentorships/ui |
| `apps/marketing/lib/validators.ts` | Re-exports from @mentorships/schemas |

---

## Files Created (Phase 3)

| File | Purpose |
|------|---------|
| `apps/marketing/inngest/functions/inventory-changed.ts` | Handles inventory change events, triggers waitlist notifications |
| `apps/web/inngest/types.ts` (updated) | Added `inventoryChangedEventSchema` type |

---

## Files Created (Phase 4)

| File | Purpose |
|------|---------|
| `apps/marketing/lib/email/waitlist-notification.ts` | Email template for waitlist availability notifications |
| `apps/marketing/inngest/functions/waitlist-notifications.ts` (MODIFIED) | Now sends actual emails via Resend (previously only marked as notified) |
| `apps/marketing/app/api/admin/waitlist-notify/route.ts` (MODIFIED) | Returns email count for verification in toast |

---

## Files Modified (Phase 5)

| File | Changes |
|------|---------|
| `apps/marketing/app/layout.tsx` | Added `<Toaster />` from sonner |
| `apps/marketing/app/waitlist/page.tsx` | Added toast notifications, removed inline error state |
| `apps/web/components/dashboard/mentee-onboarding-form.tsx` | Added toast notifications to mutations, removed inline message state |
| `apps/web/components/calendar/book-session-form.tsx` | Added toast notifications to booking mutation, removed inline error display |
| `apps/web/components/instructor/scheduling-settings-form.tsx` | Added toast notifications to save mutation, removed inline message state |

---

## Files Created (Phase 6)

| File | Purpose |
|------|---------|
| `apps/marketing/inngest/functions/inventory-available.ts` | Handles `inventory/available` events, sends waitlist notifications when inventory becomes available |

## Files Modified (Phase 6)

| File | Changes |
|------|---------|
| `apps/marketing/app/api/webhooks/kajabi/route.ts` | Fetches and sends actual `previousInventory` value to `inventory/changed` event |
| `apps/marketing/lib/supabase-inventory.ts` | Added logic to detect 0 → >0 transition in `updateInventory` function and send `inventory/available` event |
| `apps/marketing/app/api/inngest/route.ts` | Registered `handleInventoryAvailable` function |

## Files Created (Phase 7)

| File | Purpose |
|------|---------|
| `packages/db/drizzle/0015_admin_digest_settings.sql` | Database schema for digest configuration |
| `packages/db/drizzle/0016_inventory_change_log.sql` | Database schema for tracking inventory changes |
| `apps/marketing/app/admin/digest/page.tsx` | Admin UI page for digest settings |
| `apps/marketing/components/admin/digest-settings-form.tsx` | React component for digest controls |
| `apps/marketing/components/ui/switch.tsx` | UI component for enable/disable toggle |
| `apps/marketing/components/ui/select.tsx` | UI component for frequency selector |
| `apps/marketing/app/api/admin/digest-settings/route.ts` | API endpoint for getting/updating digest settings |
| `apps/marketing/app/api/admin/digest-send/route.ts` | API endpoint for manual digest trigger |
| `apps/marketing/lib/email/client.ts` | Shared email client utility (getResendClient, getFromAddress) |
| `apps/marketing/lib/email/weekly-digest.ts` | Email template builder for weekly digest (moved formatDate to module scope, fixed pseudo-selectors) |
| `apps/marketing/lib/digest-data.ts` | Data gathering functions for digest sections |
| `apps/marketing/inngest/functions/weekly-digest.ts` | Scheduled Inngest functions for automatic digests (guarded sendWeeklyDigest, checks sendResult.error, uses captured timestamp) |
| `apps/marketing/inngest/functions/inventory-available.ts` | Handles inventory/available events (added Zod schema for type, only marks successful sends as notified, uses shared email client) |

## Files Modified (Phase 7)

| File | Changes |
|------|---------|
| `packages/db/src/schema/index.ts` | Export `adminDigestSettings` schema |
| `packages/db/src/schema/admin-digest-settings.ts` | New schema file for digest settings |
| `apps/marketing/app/admin/page.tsx` | Added quick link to digest settings page |
| `apps/marketing/lib/supabase-inventory.ts` | Added `logInventoryChange` function, updated `updateInventory` to log changes |
| `apps/marketing/app/api/webhooks/kajabi/route.ts` | Added inventory change logging for Kajabi purchases |
| `apps/marketing/app/api/inngest/route.ts` | Registered `sendWeeklyDigest` and `sendScheduledDigestByFrequency` functions |

---

## Files Deleted (Phase 2)

| File | Reason |
|------|--------|
| `packages/db/src/schema/waitlist.ts` | No longer needed (Supabase source of truth) |
| `apps/marketing/lib/supabase-inventory.ts` | Functions moved to apps/web (kept local supabase.ts for client init) |
| `packages/ui/src/components/form.tsx` | Consolidated into form-field.tsx |
| `apps/web/lib/queries/api-client.ts` | Waitlist functions extracted to supabase-inventory.ts |

---

## Estimated Effort

| Phase | Status | Hours |
|-------|--------|-------|
| Phase1 | ✅ Completed | - |
| Phase 2 | ✅ Completed | ~14 hours |
| Phase 3 | ✅ Completed | ~4 hours |
| Phase 4 | ✅ Completed | ~4 hours |
| Phase 5 | ✅ Completed | ~2 hours |
| Phase 6 | ✅ Completed | ~2 hours |
| Phase 7 | ✅ Completed | ~4 hours |
| **Total** | | **~30 hours** |

---

## API Endpoints

### GET /api/instructor/:slug/inventory
```json
// Response
{
  "oneOnOneInventory": 5,
  "groupInventory": 0
}
```

### PUT /api/instructor/:slug/inventory
```json
// Request body
{
  "oneOnOneInventory": 3,
  "groupInventory": 0
}

// Response
{
  "success": true,
  "oneOnOneInventory": 3,
  "groupInventory": 0
}
```

### POST /api/webhooks/kajabi
```json
// Request body
{
  "event": "purchase",
  "payload": [...]
}
```

---

## Environment Variables Reference

### apps/marketing/.env.local
| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |

### apps/web/.env.local
| Variable | Description |
|----------|-------------|
| `KAJABI_WEBHOOK_SECRET` | Kajabi webhook signing secret |
| `INNGEST_EVENT_KEY` | Inngest event key |
| `RESEND_API_KEY` | Resend API key for emails |

---

## PR Reference

**Phase 2: Unified Waitlist with Supabase + TanStack Form**
- GitHub PR: https://github.com/dlitorja/mentorships-infra/pull/48
- Branch: `feat/phase2-waitlist-supabase`
- Status: ✅ Merged

Key changes:
- Created `@mentorships/schemas` package with shared Zod schemas
- Created `@mentorships/ui` package with FormField + Form components
- Consolidated waitlist storage to Supabase (single source of truth)
- Migrated marketing waitlist forms to TanStack Form + Zod
- Renamed `middleware.ts` → `proxy.ts` (Next.js 16)

**Phase 3: Kajabi Webhook + Inngest**
- GitHub PR: https://github.com/dlitorja/mentorships-infra/pull/50
- Branch: `feat/phase3-kajabi-inngest`
- Status: ✅ Merged

Key changes:
- Created Kajabi webhook endpoint with offer mapping verification
- Integrated Inngest for background inventory change processing
- Set up waitlist notification triggers when inventory becomes available

**Form Migrations to TanStack Form**
- GitHub PR: https://github.com/dlitorja/mentorships-infra/pull/51
- Branch: `feat/tanstack-form-migrations`
- Status: ✅ Merged

Key changes:
- Migrated 5 remaining forms to TanStack Form + Zod
- Improved type safety with documented `any` usage for generic parameters
- Optimized InventoryTable rendering with targeted subscriptions
- Fixed error handling to prevent unhandled promise rejections

**Phase 5: UI Polish**
- Status: ✅ Completed (not yet PR'd)

Key changes:
- Added `<Toaster />` to marketing app layout
- Migrated all forms to use sonner toast notifications:
  - Marketing waitlist form
  - Mentee onboarding form
  - Book session form
  - Scheduling settings form
- Removed inline error displays in favor of toast notifications
- Verified mobile responsive design across all forms
- Loading states already implemented in all forms

---

## Testing Checklist

- [x] Marketing app builds successfully
- [x] Web app builds successfully
- [x] TanStack Form components render correctly
- [x] Waitlist API endpoints respond correctly
- [x] Supabase client initializes properly
- [x] Email template created
- [x] Inngest function sends emails via Resend
- [x] Rate limiting implemented (1 email/7 days)
- [ ] Admin can access /admin after signing in
- [ ] Inventory values display correctly
- [ ] Inventory can be edited (increment/decrement)
- [ ] Instructor page shows correct button based on inventory
- [ ] Waitlist form submits successfully
- [ ] Already-on-waitlist users see appropriate message
- [ ] **Phase 4 Testing** (New):
    - [ ] Add test email to waitlist via /waitlist page
    - [ ] Admin clicks "Notify Waitlist" button in /admin/inventory
    - [ ] Toast shows correct email count
    - [ ] Email received with correct instructor name and offer URL
    - [ ] "Book Now" button links to correct Kajabi checkout
    - [ ] Rate limiting works (second click shows 0 emails)
    - [ ] Database updated with notified timestamp
- [ ] **Phase 6 Testing** (New):
    - [ ] Set inventory to 0 for an instructor/type
    - [ ] Add test email to waitlist
    - [ ] Update inventory to >0 via admin dashboard (marketing app)
    - [ ] Verify automatic email is sent to waitlisted users
    - [ ] Verify email contains correct instructor name and offer URL
    - [ ] Check database shows `notified=true` and `last_notification_at` updated
    - [ ] Update inventory back to 0
    - [ ] Update inventory to >0 again
    - [ ] Verify rate limiting works (no second email sent within 7 days)
- [ ] **Phase 7 Testing** (New):
    - [ ] Navigate to `/admin/digest` and verify UI loads correctly
    - [ ] Toggle digest enable/disable and save
    - [ ] Change frequency from weekly to daily/monthly and save
    - [ ] Update admin email address and save
    - [ ] Click "Send Now" button to manually trigger digest
    - [ ] Verify digest email received with all 5 sections populated
    - [ ] Check that `last_sent_at` timestamp updates after manual send
    - [ ] Create a waitlist signup and verify it appears in digest
    - [ ] Update inventory via admin and verify change appears in digest
    - [ ] Verify scheduled digest runs at correct time (9 AM) based on frequency
    - [ ] Verify inventory change logs are created for manual updates
    - [ ] Verify inventory change logs are created for Kajabi purchases
    - [ ] Test that disabled digest doesn't send (scheduled function should skip)

---

## Known Issues / Limitations

1. **Main DB migration not needed**: Supabase IS the PostgreSQL database (via Drizzle ORM wrapper). Marketing app uses Supabase client directly for waitlist/inventory - this is correct architecture.

2. **React peer dependency warnings**: Clerk shows warnings for React 19 but works fine.

3. **Email notifications**: ✅ IMPLEMENTED (Phase 4 complete). Manual notifications via admin "Notify Waitlist" button.

4. **TanStack Form type complexity**: `TypedFormApi` uses documented `any` for 11 of 12 generic parameters to avoid complexity. Justified in form-field.tsx lines 13-20.

5. **Automatic notifications on inventory change**: Not yet implemented. Currently requires manual admin trigger via "Notify Waitlist" button.

---

## Next Session Tasks

**Phase 5: UI Polish is now complete!** ✅

**Phase 6: Automatic Notifications is now complete!** ✅

**Phase 7: Weekly Digest is now complete!** ✅

**Testing Required:**
- End-to-end testing of digest functionality
- Verify scheduled functions trigger correctly
- Test all digest sections populate with data
- Verify inventory change logging works for both manual and Kajabi changes

**Optional Improvements:**
- [ ] Implement conversions tracking (waitlist → purchase flow)
- [ ] Consider removing `useForm` direct imports if Next.js/Turbopack workspace resolution improves
- [ ] Revisit TanStack Form types when stable generics are released

---

## Implementation Progress

| Milestone | Status | PR |
|-----------|--------|-----|
| Phase1: Database & Admin Foundation | ✅ | - |
| Phase 2: Unified Waitlist + TanStack Form | ✅ | #48 |
| Phase 3: Kajabi Webhook + Inngest | ✅ | #50 |
| Form Migrations (9 forms) | ✅ | #51 |
| Phase 4: Waitlist Notifications | ✅ | - |
| Phase 5: UI Polish | ✅ | - |
| Phase 6: Automatic Notifications | ✅ | - |
| Phase 7: Weekly Digest | ✅ | Pending |
| Main DB Migration | ⏳ Pending | - |

## Files Modified (Phase 6 & 7 - Code Review Fixes)

| File | Changes |
|------|---------|
| `apps/marketing/app/api/admin/digest-send/route.ts` | Use shared email client, check sendResult.error before updating database |
| `apps/marketing/app/api/admin/digest-settings/route.ts` | Added Zod schema validation for GET and PUT handlers |
| `apps/marketing/components/admin/digest-settings-form.tsx` | Added debounced update for admin email input, added error state UI, added Zod schema validation for fetchSettings |
| `apps/marketing/inngest/functions/inventory-available.ts` | Added Zod schema for type validation, only mark successful sends as notified, uses shared email client |
| `apps/marketing/inngest/functions/weekly-digest.ts` | Added guard to sendWeeklyDigest, check sendResult.error, use captured timestamp, removed duplicate getResendClient/getFromAddress |
| `apps/marketing/lib/email/weekly-digest.ts` | Moved formatDate to module scope, fixed :last-child pseudo-selectors with conditional logic in map callbacks |
| `apps/marketing/lib/supabase-inventory.ts` | Added Promise<void> return type to logInventoryChange, removed unused logs variable |

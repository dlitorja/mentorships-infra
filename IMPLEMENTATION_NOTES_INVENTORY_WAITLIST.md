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

### Phase 4: Waitlist Notifications (TODO)
- [ ] Email template for waitlist notifications
- [ ] Inngest function for processing notifications (extend existing)
- [ ] Weekly digest cron job
- [ ] Email frequency tracking (max once/week)
- [ ] Resend integration for sending emails

### Phase 5: UI Polish (TODO)
- [ ] Loading states
- [ ] Toast notifications
- [ ] Error handling
- [ ] Mobile responsive design

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
| Phase 1 | ✅ Completed | - |
| Phase 2 | ✅ Completed | ~14 hours |
| Phase 3 | ✅ Completed | ~4 hours |
| Phase 4 | ⏳ Pending | ~8 hours |
| Phase 5 | ⏳ Pending | ~4 hours |
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

---

## Testing Checklist

- [x] Marketing app builds successfully
- [x] Web app builds successfully
- [x] TanStack Form components render correctly
- [x] Waitlist API endpoints respond correctly
- [x] Supabase client initializes properly
- [ ] Admin can access /admin after signing in
- [ ] Inventory values display correctly
- [ ] Inventory can be edited (increment/decrement)
- [ ] Instructor page shows correct button based on inventory
- [ ] Waitlist form submits successfully
- [ ] Already-on-waitlist users see appropriate message

---

## Known Issues / Limitations

1. **Main DB migration not applied**: The main database (PostgreSQL) doesn't have inventory columns yet. The marketing app uses Supabase as source of truth for inventory.

2. **React peer dependency warnings**: Clerk shows warnings for React 19 but works fine.

3. **Email notifications not implemented**: Phase 4 not yet complete.

4. **TanStack Form type complexity**: `TypedFormApi` uses documented `any` for 11 of 12 generic parameters to avoid complexity. Justified in form-field.tsx lines 13-20.

---

## Next Session Tasks

1. **Phase 4: Waitlist Notifications** (~8 hours)
   - [ ] Email template for waitlist notifications
   - [ ] Inngest function for processing notifications (extend existing)
   - [ ] Resend integration for sending emails
   - [ ] Weekly digest cron job
   - [ ] Email frequency tracking (max once/week)

2. **Phase 5: UI Polish** (~4 hours)
   - [ ] Loading states across all forms
   - [ ] Toast notifications for success/error feedback
   - [ ] Error handling improvements
   - [ ] Mobile responsive design verification

3. **Database Migration**
   - [ ] Apply main DB migration to add inventory columns to mentors table
   - [ ] Update apps to use main DB for inventory (instead of Supabase)

4. **Optional Improvements**
   - [ ] Consider removing `useForm` direct imports if Next.js/Turbopack workspace resolution improves
   - [ ] Revisit TanStack Form types when stable generics are released

---

## Implementation Progress

| Milestone | Status | PR |
|-----------|--------|-----|
| Phase 1: Database & Admin Foundation | ✅ | - |
| Phase 2: Unified Waitlist + TanStack Form | ✅ | #48 |
| Phase 3: Kajabi Webhook + Inngest | ✅ | #50 |
| Form Migrations (9 forms) | ✅ | #51 |
| Phase 4: Waitlist Notifications | ⏳ Pending | - |
| Phase 5: UI Polish | ⏳ Pending | - |
| Main DB Migration | ⏳ Pending | - |

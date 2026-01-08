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

- **PR #48**: Phase 2 implementation in review/iteration
- **Build Status**: ✅ Both apps build successfully
- **TanStack Form**: Uses `any` types workaround (see Known Issues)
- **Middleware**: Renamed to `proxy.ts` (Next.js 16 requirement)

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

### Phase 3: Kajabi Webhook Integration (TODO)
- [ ] Create `/api/webhooks/kajabi` endpoint in apps/web
- [ ] Verify webhook signature
- [ ] Decrement inventory on purchase via Supabase RPC
- [ ] Trigger notification flow when inventory goes 0 → available

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
| Already using TanStack Form | 4 |
| Using manual state (TO MIGRATE) | 5 |
| Using react-hook-form | 0 |

**Migration Order:**
1. MenteeOnboardingForm (HIGH - core flow)
2. BookSessionForm (HIGH - core flow)
3. SchedulingSettingsForm (MEDIUM - complex nested state)
4. Checkout page (LOW - simple)
5. InventoryTable (LOW - admin only)

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

## Files Deleted (Phase 2)

| File | Reason |
|------|--------|
| `packages/db/src/schema/waitlist.ts` | No longer needed (Supabase source of truth) |
| `apps/marketing/lib/supabase-inventory.ts` | Functions moved to apps/web (kept local supabase.ts for client init) |
| `packages/ui/src/components/form.tsx` | Consolidated into form-field.tsx |
| `apps/web/lib/queries/api-client.ts` | Waitlist functions extracted to supabase-inventory.ts |

---

## Estimated Effort

| Phase | Hours |
|-------|-------|
| Phase 2 | ~14 hours |
| Phase 3 | ~6 hours |
| Phase 4 | ~8 hours |
| Phase 5 | ~4 hours |
| **Total** | **~32 hours** |

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
- Status: In review

Key changes:
- Created `@mentorships/schemas` package with shared Zod schemas
- Created `@mentorships/ui` package with FormField + Form components
- Consolidated waitlist storage to Supabase (single source of truth)
- Migrated marketing waitlist forms to TanStack Form + Zod
- Renamed `middleware.ts` → `proxy.ts` (Next.js 16)

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

1. **Main DB migration not applied**: The main database (PostgreSQL) doesn't have the inventory columns yet. The marketing app uses Supabase as the source of truth for inventory.

2. **React peer dependency warnings**: Clerk shows warnings for React 19 but works fine.

3. **Email notifications not implemented**: Phase 4 not yet complete.

4. **TanStack Form v1.27 type complexity**: Uses `any` types in FormContext due to FormApi requiring 11-12 type arguments. TODO: Replace with strict interface when TanStack Form exposes stable types.

5. **Forms using manual state**: 5 forms need migration to TanStack Form + Zod (see Forms Audit Summary).

6. **Middleware deprecated**: Renamed `middleware.ts` to `proxy.ts` per Next.js 16 requirements.

---

## Next Session Tasks

1. **Phase 3: Kajabi Webhook Integration**
   - Create `/api/webhooks/kajabi` endpoint in apps/web
   - Verify webhook signature
   - Decrement inventory on purchase
   - Trigger notification flow

2. **Phase 4: Waitlist Notifications**
   - Email template for waitlist notifications
   - Inngest function for processing notifications
   - Resend integration for sending emails

3. **Complete Form Migrations**
   - MenteeOnboardingForm (file upload flow)
   - BookSessionForm (query-based slots)
   - SchedulingSettingsForm (nested state)
   - Checkout page (simple form)
   - InventoryTable (admin UI)

4. **Known Issues to Address**
   - [ ] Update FormContext types when TanStack Form releases stable generics
   - [ ] Remove middleware.ts → proxy.ts rename note (done)
   - [ ] Add PR reference for Phase 2 changes

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
                 │   Supabase (for marketing)    │
                 │   - instructor_inventory      │
                 │   - kajabi_offer_mappings     │
                 │   - marketing_waitlist        │
                 ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Web App (apps/web)                          │
├─────────────────────────────────────────────────────────────────┤
│  API Routes                 │  Database (PostgreSQL)            │
│  - /api/instructor/:slug/inventory                              │
│  - /api/webhooks/kajabi     │  - mentors table (future use)     │
│                             │  - kajabi_offers table            │
└────────────────┬────────────────┬───────────────────────────────┘
                 │                │
                 ▼                ▼
          ┌───────────┐   ┌───────────────┐
          │  Resend   │   │   Inngest     │
          │  (Email)  │   │   (Background)│
          └───────────┘   └───────────────┘
```

## Database Schema

### Supabase Tables (Marketing App)

**`instructor_inventory`**
- `id` UUID (PK)
- `instructor_slug` TEXT (UNIQUE)
- `one_on_one_inventory` INTEGER (DEFAULT 0)
- `group_inventory` INTEGER (DEFAULT 0)
- `created_at` TIMESTAMP
- `updated_at` TIMESTAMP
- `updated_by` TEXT

**`kajabi_offer_mappings`**
- `id` UUID (PK)
- `offer_id` TEXT (UNIQUE)
- `instructor_slug` TEXT
- `mentorship_type` TEXT ('one-on-one' | 'group')
- `kajabi_offer_url` TEXT
- `created_at` TIMESTAMP
- `updated_at` TIMESTAMP

**`marketing_waitlist`**
- `id` UUID (PK)
- `email` TEXT
- `instructor_slug` TEXT
- `mentorship_type` TEXT
- `notified` BOOLEAN (DEFAULT FALSE)
- `last_notification_at` TIMESTAMP
- `created_at` TIMESTAMP
- `updated_at` TIMESTAMP
- UNIQUE(email, instructor_slug, mentorship_type)

### Main DB Tables (apps/web)

**`mentors` table additions:**
- `one_on_one_inventory` INTEGER (DEFAULT 0)
- `group_inventory` INTEGER (DEFAULT 0)

**`kajabi_offers` table:**
- `id` TEXT (PK) - Kajabi offer ID
- `instructor_slug` TEXT
- `type` waitlist_type ('one-on-one' | 'group')
- `created_at` TIMESTAMP

---

## Files Created/Modified

### Database Layer (packages/db)

| File | Description |
|------|-------------|
| `src/schema/mentors.ts` | Added inventory columns to mentors table |
| `src/schema/kajabi-offers.ts` | New schema for Kajabi offer mappings |
| `drizzle/0013_melodic_black_widow.sql` | Migration for main DB (future use) |
| `MARKETING_INVENTORY_SQL.sql` | Supabase SQL for marketing tables |

### API Layer (apps/web)

| File | Description |
|------|-------------|
| `app/api/instructor/inventory/route.ts` | GET/PUT inventory endpoints |
| `lib/inventory.ts` | Inventory helper functions |

### Marketing App (apps/marketing)

| File | Description |
|------|-------------|
| `lib/supabase-inventory.ts` | Supabase client for inventory management |
| `lib/inventory.ts` | Client for fetching inventory from web app |
| `middleware.ts` | Clerk middleware protecting /admin routes |
| `lib/auth.ts` | Admin authentication helpers (requireAdmin) |
| `app/layout.tsx` | Added ClerkProvider wrapper |
| `app/admin/layout.tsx` | Admin layout with sidebar |
| `app/admin/page.tsx` | Dashboard with stats |
| `app/admin/inventory/page.tsx` | Inventory management page |
| `app/admin/sign-in/[[...sign-in]]/page.tsx` | Admin sign-in page |
| `components/admin/admin-sidebar.tsx` | Navigation sidebar |
| `components/admin/inventory-table.tsx` | Editable inventory table |
| `package.json` | Added @clerk/nextjs, @supabase/supabase-js |

---

## Configuration Required

### 1. Environment Variables (apps/marketing/.env.local)

```env
# Clerk (same instance as web app)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Supabase (shared with web app)
NEXT_PUBLIC_SUPABASE_URL=https://ytxtlscmxyqomxhripki.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1...
```

### 2. Run Supabase SQL

Execute `packages/db/MARKETING_INVENTORY_SQL.sql` in your Supabase SQL Editor to create:
- `instructor_inventory` table
- `kajabi_offer_mappings` table
- `marketing_waitlist` table
- Database functions (decrement_inventory, trigger_waitlist_notifications)
- RLS policies

### 3. Clerk Setup

1. Go to Clerk Dashboard → Users → Metadata
2. Add `publicMetadata.role = "admin"` for admin users
3. Or configure admin by email in `lib/auth.ts`:
   ```typescript
   user?.emailAddresses?.[0]?.emailAddress === "admin@huckleberry.art"
   ```

### 4. Kajabi Webhook Setup

1. Go to Kajabi → Settings → Developer → Webhooks
2. Add webhook:
   - **URL**: `https://your-domain.com/api/webhooks/kajabi`
   - **Events**: `purchase`
3. Copy signing secret to `KAJABI_WEBHOOK_SECRET` env var

---

## Implementation Phases

### ✅ Phase 1: Database & Admin Foundation (COMPLETED)
- [x] Database schemas (main DB + Supabase)
- [x] Inventory API routes
- [x] Clerk authentication
- [x] Admin dashboard UI

### Phase 2: Instructor Profile Updates (TODO)
- [ ] Update instructor pages to fetch inventory from Supabase
- [ ] Show "Buy Now" when inventory > 0
- [ ] Show "Join Waitlist" when inventory === 0

### Phase 3: Kajabi Webhook Integration (TODO)
- [ ] Create `/api/webhooks/kajabi` endpoint
- [ ] Verify webhook signature
- [ ] Decrement inventory on purchase
- [ ] Trigger notification flow when inventory goes 0 → available

### Phase 4: Waitlist Notifications (TODO)
- [ ] Email template for waitlist notifications
- [ ] Inngest function for processing notifications
- [ ] Weekly digest cron job
- [ ] Email frequency tracking (max once/week)

### Phase 5: UI Polish (TODO)
- [ ] Loading states
- [ ] Toast notifications
- [ ] Error handling
- [ ] Mobile responsive design

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

## Testing Checklist

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

---

## Next Session Tasks

1. Verify Supabase SQL was executed
2. Add environment variables
3. Test admin dashboard access
4. Update instructor pages to use inventory data
5. Create Kajabi webhook endpoint

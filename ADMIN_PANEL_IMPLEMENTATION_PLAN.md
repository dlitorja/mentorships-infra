# Marketing Admin Panel Implementation Plan

**Goal**: Enable business partner to edit content on `apps/marketing` via a custom admin panel.

**Approach**: Custom admin panel using Supabase (existing infrastructure) + Clerk authentication (minimal setup for marketing app).

**Estimated Timeline**: 4-6 days

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema](#database-schema)
3. [Phase 1: Foundation (Day 1-2)](#phase-1-foundation-day-1-2)
4. [Phase 2: Core Features (Day 3-4)](#phase-2-core-features-day-3-4)
5. [Phase 3: Polish & Testing (Day 5-6)](#phase-3-polish--testing-day-5-6)
6. [File Structure](#file-structure)
7. [Dependencies](#dependencies)
8. [Environment Variables](#environment-variables)
9. [Security Considerations](#security-considerations)
10. [Testing Checklist](#testing-checklist)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Marketing App (apps/marketing)            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐         ┌──────────────┐                  │
│  │  Public Site │         │  Admin Panel │                  │
│  │  (/)         │         │  (/admin)   │                  │
│  └──────┬───────┘         └──────┬──────┘                  │
│         │                         │                          │
│         │                         │ (Protected by Clerk)     │
│         │                         │                          │
│         └──────────┬──────────────┘                          │
│                    │                                         │
│                    ▼                                         │
│         ┌──────────────────────┐                           │
│         │   API Routes          │                           │
│         │   (/api/admin/*)      │                           │
│         └──────────┬────────────┘                           │
│                    │                                         │
└────────────────────┼─────────────────────────────────────────┘
                     │
                     ▼
         ┌──────────────────────┐
         │   Supabase Database  │
         │   - instructors      │
         │   - marketing_content│
         │   - testimonials      │
         │   - admin_users      │
         └──────────────────────┘
```

### Key Design Decisions

1. **Authentication**: Use Clerk (minimal setup, just for admin access)
2. **Database**: Supabase (already in use, no new service)
3. **Storage**: Supabase Storage for images (instructor photos, portfolio)
4. **Admin Access**: Role-based (only users with `admin` role in Clerk)
5. **Content Updates**: Real-time via Supabase queries (no revalidation needed for most content)

---

## Database Schema

### 1. Instructors Table

```sql
CREATE TABLE marketing_instructors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tagline TEXT NOT NULL,
  bio TEXT NOT NULL,
  specialties TEXT[] NOT NULL DEFAULT '{}',
  background TEXT[] NOT NULL DEFAULT '{}',
  profile_image_url TEXT,
  work_images TEXT[] DEFAULT '{}',
  pricing JSONB, -- { oneOnOne: number, group?: number }
  offers JSONB NOT NULL DEFAULT '[]', -- [{ kind: string, label: string, url: string, active: boolean }]
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT, -- Clerk user ID
  updated_by TEXT   -- Clerk user ID
);

CREATE INDEX idx_marketing_instructors_slug ON marketing_instructors(slug);
CREATE INDEX idx_marketing_instructors_created_at ON marketing_instructors(created_at DESC);
```

### 2. Marketing Content Table

```sql
CREATE TABLE marketing_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT UNIQUE NOT NULL, -- 'hero', 'how-it-works', 'cta', 'footer', etc.
  content JSONB NOT NULL, -- Flexible JSON structure per section
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT -- Clerk user ID
);

CREATE INDEX idx_marketing_content_section ON marketing_content(section);
```

**Content Structure Examples**:

```json
// Hero section
{
  "title": "Huckleberry Art Mentorships",
  "subtitle": "Personalized mentorship experiences with world-class instructors.",
  "description": "Learn from industry professionals...",
  "ctaPrimary": { "text": "Browse Instructors", "href": "/instructors" },
  "ctaSecondary": { "text": "How it works", "href": "#how-it-works" }
}

// How It Works section
{
  "title": "How it works",
  "steps": [
    {
      "number": 1,
      "title": "Choose an instructor",
      "description": "Browse profiles, portfolios, and specialties..."
    },
    {
      "number": 2,
      "title": "Purchase on their offer page",
      "description": "When you're ready, complete your purchase..."
    },
    {
      "number": 3,
      "title": "Start your mentorship",
      "description": "After your purchase is completed..."
    }
  ]
}
```

### 3. Testimonials Table

```sql
CREATE TABLE marketing_testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID REFERENCES marketing_instructors(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  author TEXT NOT NULL,
  role TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT, -- Clerk user ID
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT   -- Clerk user ID
);

CREATE INDEX idx_marketing_testimonials_instructor ON marketing_testimonials(instructor_id);
CREATE INDEX idx_marketing_testimonials_created_at ON marketing_testimonials(created_at DESC);
```

### 4. Row Level Security (RLS)

```sql
-- Enable RLS on all tables
ALTER TABLE marketing_instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_testimonials ENABLE ROW LEVEL SECURITY;

-- Public read access (for marketing site)
CREATE POLICY "Public read access" ON marketing_instructors
  FOR SELECT USING (true);

CREATE POLICY "Public read access" ON marketing_content
  FOR SELECT USING (true);

CREATE POLICY "Public read access" ON marketing_testimonials
  FOR SELECT USING (true);

-- Admin write access (handled via API routes with Clerk auth, not RLS)
-- RLS policies will be permissive for writes, API routes handle auth
```

**Note**: Since we're using Clerk for authentication and API routes for writes, RLS will primarily be for read access. Write operations will be validated in API routes.

---

## Phase 1: Foundation (Day 1-2)

### Step 1.1: Set Up Clerk in Marketing App

**Files to create/modify**:

1. **Install Clerk** (if not already in marketing app)
   ```bash
   cd apps/marketing
   pnpm add @clerk/nextjs
   ```

2. **Create `apps/marketing/middleware.ts`**
   ```typescript
   import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

   const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

   export default clerkMiddleware(async (auth, req) => {
     if (isAdminRoute(req)) {
       const { userId } = await auth();
       if (!userId) {
         // Redirect to sign-in
         const signInUrl = new URL("/admin/sign-in", req.url);
         signInUrl.searchParams.set("redirect_url", req.url);
         return Response.redirect(signInUrl);
       }
     }
   });

   export const config = {
     matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/", "/(api|trpc)(.*)"],
   };
   ```

3. **Create `apps/marketing/lib/auth.ts`**
   ```typescript
   import { auth, currentUser } from "@clerk/nextjs/server";

   export async function requireAdmin() {
     const { userId } = await auth();
     if (!userId) {
       throw new Error("Unauthorized");
     }

     const user = await currentUser();
     // Check if user has admin role (you'll set this in Clerk dashboard)
     // For now, you can check email or metadata
     const isAdmin = user?.publicMetadata?.role === "admin" || 
                     user?.emailAddresses?.[0]?.emailAddress === "admin@huckleberry.art";
     
     if (!isAdmin) {
       throw new Error("Forbidden: Admin access required");
     }

     return userId;
   }
   ```

4. **Update `apps/marketing/app/layout.tsx`** to include ClerkProvider
   ```typescript
   import { ClerkProvider } from "@clerk/nextjs";
   
   export default function RootLayout({ children }) {
     return (
       <ClerkProvider>
         {children}
       </ClerkProvider>
     );
   }
   ```

### Step 1.2: Set Up Supabase Client in Marketing App

**Files to create**:

1. **Create `apps/marketing/lib/supabase.ts`**
   ```typescript
   import { createClient } from "@supabase/supabase-js";
   import { cookies } from "next/headers";

   export async function createSupabaseClient() {
     const cookieStore = await cookies();
     
     return createClient(
       process.env.NEXT_PUBLIC_SUPABASE_URL!,
       process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
       {
         cookies: {
           getAll() {
             return cookieStore.getAll();
           },
           setAll(cookiesToSet) {
             // Handle cookie setting if needed
           },
         },
       }
     );
   }

   // Admin client with service role (for admin operations)
   export function createSupabaseAdminClient() {
     return createClient(
       process.env.NEXT_PUBLIC_SUPABASE_URL!,
       process.env.SUPABASE_SERVICE_ROLE_KEY!,
       {
         auth: {
           persistSession: false,
           autoRefreshToken: false,
         },
       }
     );
   }
   ```

### Step 1.3: Create Database Migrations

**Files to create**:

1. **Create `packages/db/drizzle/migrations/XXXX_marketing_admin.sql`**
   - Run the SQL schema from [Database Schema](#database-schema) section
   - Or use Drizzle Kit to generate migration

2. **Update `packages/db/src/schema/marketing.ts`** (new file)
   ```typescript
   import { pgTable, uuid, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
   import { relations } from "drizzle-orm";

   export const marketingInstructors = pgTable("marketing_instructors", {
     id: uuid("id").primaryKey().defaultRandom(),
     name: text("name").notNull(),
     slug: text("slug").notNull().unique(),
     tagline: text("tagline").notNull(),
     bio: text("bio").notNull(),
     specialties: text("specialties").array().notNull().default([]),
     background: text("background").array().notNull().default([]),
     profileImageUrl: text("profile_image_url"),
     workImages: text("work_images").array().default([]),
     pricing: jsonb("pricing"),
     offers: jsonb("offers").notNull().default([]),
     createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
     updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
     createdBy: text("created_by"),
     updatedBy: text("updated_by"),
   });

   export const marketingContent = pgTable("marketing_content", {
     id: uuid("id").primaryKey().defaultRandom(),
     section: text("section").notNull().unique(),
     content: jsonb("content").notNull(),
     updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
     updatedBy: text("updated_by"),
   });

   export const marketingTestimonials = pgTable("marketing_testimonials", {
     id: uuid("id").primaryKey().defaultRandom(),
     instructorId: uuid("instructor_id").references(() => marketingInstructors.id, { onDelete: "cascade" }),
     text: text("text").notNull(),
     author: text("author").notNull(),
     role: text("role"),
     createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
     createdBy: text("created_by"),
     updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
     updatedBy: text("updated_by"),
   });

   export const marketingInstructorsRelations = relations(marketingInstructors, ({ many }) => ({
     testimonials: many(marketingTestimonials),
   }));

   export const marketingTestimonialsRelations = relations(marketingTestimonials, ({ one }) => ({
     instructor: one(marketingInstructors, {
       fields: [marketingTestimonials.instructorId],
       references: [marketingInstructors.id],
     }),
   }));
   ```

3. **Run migration**
   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

### Step 1.4: Create Admin Layout

**Files to create**:

1. **Create `apps/marketing/app/admin/layout.tsx`**
   ```typescript
   import { requireAdmin } from "@/lib/auth";
   import { AdminSidebar } from "@/components/admin/admin-sidebar";

   export default async function AdminLayout({
     children,
   }: {
     children: React.ReactNode;
   }) {
     await requireAdmin(); // Protect all admin routes

     return (
       <div className="min-h-screen bg-background">
         <div className="flex">
           <AdminSidebar />
           <main className="flex-1 p-8">{children}</main>
         </div>
       </div>
     );
   }
   ```

2. **Create `apps/marketing/components/admin/admin-sidebar.tsx`**
   ```typescript
   "use client";

   import Link from "next/link";
   import { usePathname } from "next/navigation";
   import { cn } from "@/lib/utils";
   import { 
     Users, 
     FileText, 
     MessageSquare, 
     Home,
     Settings 
   } from "lucide-react";

   const navItems = [
     { href: "/admin", label: "Dashboard", icon: Home },
     { href: "/admin/instructors", label: "Instructors", icon: Users },
     { href: "/admin/content", label: "Content", icon: FileText },
     { href: "/admin/testimonials", label: "Testimonials", icon: MessageSquare },
   ];

   export function AdminSidebar() {
     const pathname = usePathname();

     return (
       <aside className="w-64 border-r bg-muted/30 p-4">
         <h2 className="mb-6 text-xl font-bold">Admin Panel</h2>
         <nav className="space-y-2">
           {navItems.map((item) => {
             const Icon = item.icon;
             const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
             return (
               <Link
                 key={item.href}
                 href={item.href}
                 className={cn(
                   "flex items-center gap-3 rounded-lg px-4 py-2 transition-colors",
                   isActive
                     ? "bg-primary text-primary-foreground"
                     : "hover:bg-muted"
                 )}
               >
                 <Icon className="h-5 w-5" />
                 {item.label}
               </Link>
             );
           })}
         </nav>
       </aside>
     );
   }
   ```

3. **Create `apps/marketing/app/admin/page.tsx`** (Dashboard)
   ```typescript
   import { requireAdmin } from "@/lib/auth";
   import { createSupabaseClient } from "@/lib/supabase";
   import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

   export default async function AdminDashboard() {
     await requireAdmin();
     const supabase = await createSupabaseClient();

     // Get stats
     const { count: instructorCount } = await supabase
       .from("marketing_instructors")
       .select("*", { count: "exact", head: true });

     const { count: testimonialCount } = await supabase
       .from("marketing_testimonials")
       .select("*", { count: "exact", head: true });

     return (
       <div>
         <h1 className="mb-6 text-3xl font-bold">Admin Dashboard</h1>
         <div className="grid gap-4 md:grid-cols-3">
           <Card>
             <CardHeader>
               <CardTitle>Instructors</CardTitle>
             </CardHeader>
             <CardContent>
               <p className="text-2xl font-bold">{instructorCount || 0}</p>
             </CardContent>
           </Card>
           <Card>
             <CardHeader>
               <CardTitle>Testimonials</CardTitle>
             </CardHeader>
             <CardContent>
               <p className="text-2xl font-bold">{testimonialCount || 0}</p>
             </CardContent>
           </Card>
         </div>
       </div>
     );
   }
   ```

---

## Phase 2: Core Features (Day 3-4)

### Step 2.1: Instructor Management

**Files to create**:

1. **Create `apps/marketing/app/admin/instructors/page.tsx`** (List view)
2. **Create `apps/marketing/app/admin/instructors/[id]/page.tsx`** (Edit form)
3. **Create `apps/marketing/app/api/admin/instructors/route.ts`** (API routes)
4. **Create `apps/marketing/components/admin/instructor-form.tsx`** (Form component)

**Key features**:
- List all instructors with search/filter
- Create new instructor
- Edit existing instructor
- Delete instructor (with confirmation)
- Image upload for profile and portfolio
- Manage offers (Kajabi URLs)
- Manage testimonials per instructor

### Step 2.2: Marketing Content Management

**Files to create**:

1. **Create `apps/marketing/app/admin/content/page.tsx`** (List of content sections)
2. **Create `apps/marketing/app/admin/content/[section]/page.tsx`** (Edit form)
3. **Create `apps/marketing/app/api/admin/content/route.ts`** (API routes)
4. **Create `apps/marketing/components/admin/content-editor.tsx`** (Rich text editor)

**Key features**:
- Edit hero section (title, subtitle, description, CTAs)
- Edit "How it works" section (steps)
- Edit CTA sections
- Edit footer content
- Preview changes before saving

### Step 2.3: Testimonials Management

**Files to create**:

1. **Create `apps/marketing/app/admin/testimonials/page.tsx`** (List view)
2. **Create `apps/marketing/app/admin/testimonials/[id]/page.tsx`** (Edit form)
3. **Create `apps/marketing/app/api/admin/testimonials/route.ts`** (API routes)

**Key features**:
- List all testimonials
- Filter by instructor
- Add new testimonial
- Edit testimonial
- Delete testimonial
- Associate with instructor

### Step 2.4: Image Upload

**Files to create**:

1. **Create `apps/marketing/app/api/admin/upload/route.ts`** (Upload handler)
2. **Create `apps/marketing/components/admin/image-upload.tsx`** (Upload component)

**Key features**:
- Upload to Supabase Storage bucket `marketing-assets`
- Support for profile images and portfolio images
- Image optimization/resizing (optional, can use Next.js Image)
- Delete images

---

## Phase 3: Polish & Testing (Day 5-6)

### Step 3.1: Update Public Site to Use Supabase

**Files to modify**:

1. **Update `apps/marketing/lib/instructors.ts`** to fetch from Supabase
   ```typescript
   import { createSupabaseClient } from "@/lib/supabase";

   export async function getInstructors() {
     const supabase = await createSupabaseClient();
     const { data, error } = await supabase
       .from("marketing_instructors")
       .select("*")
       .order("created_at", { ascending: false });

     if (error) throw error;
     return data;
   }
   ```

2. **Update `apps/marketing/app/page.tsx`** to fetch marketing content from Supabase
3. **Update `apps/marketing/app/instructors/[slug]/page.tsx`** to fetch from Supabase

### Step 3.2: Add Data Migration Script

**Files to create**:

1. **Create `scripts/migrate-marketing-data.ts`**
   - Migrate existing instructor data from `lib/instructors.ts` to Supabase
   - Migrate marketing content from hardcoded values to Supabase

### Step 3.3: Add Validation & Error Handling

- Form validation using Zod
- Error boundaries for admin pages
- Toast notifications for success/error
- Loading states

### Step 3.4: Add Preview Mode

- Preview changes before publishing
- Draft/published states (optional)

---

## File Structure

```
apps/marketing/
├── app/
│   ├── admin/
│   │   ├── layout.tsx                    # Admin layout with sidebar
│   │   ├── page.tsx                      # Dashboard
│   │   ├── instructors/
│   │   │   ├── page.tsx                  # List instructors
│   │   │   └── [id]/
│   │   │       └── page.tsx              # Edit instructor
│   │   ├── content/
│   │   │   ├── page.tsx                  # List content sections
│   │   │   └── [section]/
│   │   │       └── page.tsx              # Edit content section
│   │   └── testimonials/
│   │       ├── page.tsx                  # List testimonials
│   │       └── [id]/
│   │           └── page.tsx              # Edit testimonial
│   ├── api/
│   │   └── admin/
│   │       ├── instructors/
│   │       │   └── route.ts              # CRUD for instructors
│   │       ├── content/
│   │       │   └── route.ts              # CRUD for content
│   │       ├── testimonials/
│   │       │   └── route.ts              # CRUD for testimonials
│   │       └── upload/
│   │           └── route.ts              # Image upload
│   └── ... (existing public pages)
├── components/
│   └── admin/
│       ├── admin-sidebar.tsx
│       ├── instructor-form.tsx
│       ├── content-editor.tsx
│       ├── image-upload.tsx
│       └── ... (other admin components)
├── lib/
│   ├── auth.ts                           # Admin auth helpers
│   ├── supabase.ts                       # Supabase client
│   └── instructors.ts                    # Updated to use Supabase
├── middleware.ts                         # Clerk middleware
└── ... (existing files)
```

---

## Dependencies

### New dependencies for marketing app:

```json
{
  "dependencies": {
    "@clerk/nextjs": "^6.36.5",           // Already in root, add to marketing
    "@supabase/ssr": "^0.7.0",            // Already in root
    "@supabase/supabase-js": "^2.81.1",   // Already in root
    "react-hook-form": "^7.53.0",        // For forms (or use TanStack Form)
    "@hookform/resolvers": "^3.9.0",      // Zod resolver
    "zod": "^4.1.13",                     // Already in root
    "sonner": "^2.0.7"                    // Already in root (toasts)
  }
}
```

**Note**: Most dependencies are already in the monorepo root, just need to add to marketing app's `package.json`.

---

## Environment Variables

### Add to `apps/marketing/.env.local`:

```env
# Clerk (for admin authentication)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Supabase (for content storage)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # For admin operations

# Supabase Storage bucket
NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET=marketing-assets
```

---

## Security Considerations

1. **Authentication**: All admin routes protected by Clerk middleware
2. **Authorization**: Only users with `admin` role can access admin panel
3. **API Routes**: All admin API routes verify authentication
4. **Image Uploads**: Validate file types and sizes
5. **SQL Injection**: Use Supabase client (parameterized queries)
6. **XSS**: Sanitize user input, especially in rich text fields
7. **Rate Limiting**: Consider adding rate limiting to admin API routes (can use existing Arcjet setup)

---

## Testing Checklist

### Phase 1 Testing
- [ ] Clerk authentication works
- [ ] Admin routes are protected
- [ ] Non-admin users cannot access admin panel
- [ ] Supabase connection works
- [ ] Database tables created successfully

### Phase 2 Testing
- [ ] Can create new instructor
- [ ] Can edit existing instructor
- [ ] Can delete instructor
- [ ] Image upload works (profile and portfolio)
- [ ] Can edit marketing content sections
- [ ] Can add/edit/delete testimonials
- [ ] Form validation works
- [ ] Error handling works

### Phase 3 Testing
- [ ] Public site displays data from Supabase
- [ ] Data migration completed successfully
- [ ] All existing content still displays correctly
- [ ] Admin can preview changes
- [ ] Toast notifications work
- [ ] Loading states work

### User Acceptance Testing
- [ ] Business partner can log in
- [ ] Business partner can edit instructor info
- [ ] Business partner can upload images
- [ ] Business partner can edit marketing content
- [ ] Changes appear on public site immediately (or after revalidation)

---

## Migration Strategy

### Step 1: Set up admin panel (don't break existing site)
- Create admin panel alongside existing static content
- Test admin panel thoroughly

### Step 2: Migrate data
- Run migration script to copy existing data to Supabase
- Verify data integrity

### Step 3: Switch public site to use Supabase
- Update public pages to fetch from Supabase
- Keep fallback to static data if Supabase fails
- Test thoroughly

### Step 4: Remove static data
- Once confident, remove hardcoded data from `lib/instructors.ts`
- Clean up unused files

---

## Next Steps After Implementation

1. **Documentation**: Create user guide for business partner
2. **Training**: Walk business partner through admin panel
3. **Monitoring**: Set up error tracking for admin operations
4. **Backup**: Set up regular backups of Supabase data
5. **Analytics**: Track admin usage (optional)

---

## Estimated Effort Breakdown

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| Phase 1 | Foundation setup | 1-2 days |
| Phase 2 | Core features | 2-3 days |
| Phase 3 | Polish & testing | 1 day |
| **Total** | | **4-6 days** |

---

## Questions to Resolve

1. **Clerk Setup**: Do you want to use the same Clerk instance as `apps/web` or separate?
   - **Recommendation**: Same instance, different app (simpler, one auth system)

2. **Image Storage**: Use Supabase Storage or keep images in `public/` folder?
   - **Recommendation**: Supabase Storage (easier for admin to manage)

3. **Content Revalidation**: Real-time updates or ISR with revalidation?
   - **Recommendation**: Real-time for admin edits, ISR for public site (best of both)

4. **Rich Text Editor**: Which editor to use?
   - **Options**: Tiptap, Lexical, or simple textarea
   - **Recommendation**: Start with textarea, upgrade to Tiptap if needed

---

## Success Criteria

✅ Business partner can log in to admin panel  
✅ Business partner can edit instructor information  
✅ Business partner can upload images  
✅ Business partner can edit marketing content  
✅ Changes appear on public site  
✅ No breaking changes to existing public site  
✅ Admin panel is secure (only admins can access)  

---

**Ready to start?** Let me know if you'd like me to begin with Phase 1, or if you have any questions about the plan!


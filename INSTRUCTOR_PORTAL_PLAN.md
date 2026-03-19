# Huckleberry Drive Implementation Plan

## Current Status

**Phase 1: Complete** ✅ (PR #97 merged)
- Created `apps/huckleberry-drive` Next.js 16 app
- Configured Clerk authentication middleware
- Set up directory structure (dashboard, uploads, admin, api routes)
- Added auth helpers (requireMentor, requireAdmin, canAccessFile)
- Added dev:huckleberry script to root package.json

**Phase 2: Complete** ✅
- Added "video_editor" to userRoleEnum in packages/db
- Created videoEditorAssignments schema
- Added query helpers (getAssignedInstructorIds, isVideoEditorAssignedToInstructor, etc.)
- Updated auth.ts with requireVideoEditor(), canAccessFile(), getAccessibleInstructorIds()
- Middleware already configured (protects all routes except sign-in)

**Phase 3: Complete** ✅
- Created packages/storage with B2 S3 client
- Implemented multipart upload functions (initiate, complete, abort)
- Implemented download functions (getDownloadUrl)
- Implemented file operations (delete, headFile, fileExists)
- Implemented archive functions (copyToS3, verifyS3Upload, deleteFromB2)
- Implemented cost estimation functions
- Added @mentorships/storage to huckleberry-drive dependencies

**Phase 4: Complete** ✅
- Created `instructorUploads` table schema with upload status and transfer status enums
- Created `monthlyStorageCosts` table schema for cost tracking
- Added query helpers (getInstructorUploads, getUploadById, getFilesForArchiving, etc.)
- Added cost helpers (getMonthlyCost, upsertMonthlyCost, etc.)
- Updated schema index.ts to export new schemas
- Updated db/index.ts to export new query helpers

---

## Next Steps (Remaining Phases)

### Phase 5: API Routes
- `/api/uploads/initiate` - Initiate multipart upload
- `/api/uploads/complete` - Complete multipart upload  
- `/api/uploads/abort` - Abort upload
- `/api/files` - List/delete files
- `/api/download/[id]` - Generate download URL
- `/api/costs` - Get storage costs

### Phase 6: Background Jobs (Trigger.dev)
- Archive old files (30 days → S3 Glacier)
- Cost calculation job
- Retry failed transfers
- Archive warning emails

### Phase 7: Frontend Features
- Upload page with Uppy/TUS
- Dashboard with file list and status
- Admin costs page with charts

### Phase 8: Environment Variables
- Configure B2, Cloudflare, AWS S3, Trigger.dev env vars

---

## Quick Start Commands

```bash
# Start development
pnpm dev:huckleberry

# Run migrations (Phase 4)
pnpm --filter @mentorships/db migrate

# Deploy to Vercel (Phase 8)
```

---

## Notes
- Video editor role requires migration: `ALTER TYPE user_role ADD VALUE 'video_editor'`
- Unique constraint added: videoEditorAssignments (videoEditorId, instructorId)
- Index added: videoEditorAssignments (instructorId)

---

## Overview

A separate Next.js application for instructors to upload video footage, storing files in Backblaze B2 for cost-effective storage with automatic archival to AWS S3 Glacier Deep Archive after 30 days.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Huckleberry Drive App                        │
│                    (apps/huckleberry-drive)                     │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │ Upload   │  │ Dashboard │  │  Admin   │  │  Cost View   │    │
│  │   Page   │  │   Page    │  │  Panel   │  │  (Charts)    │    │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └──────┬───────┘    │
│       │              │             │                │            │
│       └──────────────┴─────────────┴────────────────┘            │
│                              │                                    │
│                    ┌─────────▼─────────┐                         │
│                    │   API Routes       │                         │
│                    │ /api/uploads/*    │                         │
│                    │ /api/files/*      │                         │
│                    │ /api/download/*   │                         │
│                    │ /api/costs/*      │                         │
│                    └─────────┬─────────┘                         │
└──────────────────────────────┼────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Clerk Auth  │    │  Backblaze B2 │    │   AWS S3     │
│  (Shared)     │    │ (Short-term)  │    │ (Archive)     │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        │                    ▼                    │
        │            ┌───────────────┐            │
        │            │ Cloudflare    │            │
        │            │ CDN (Free     │            │
        │            │ Egress)       │            │
        │            └───────┬───────┘            │
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  PostgreSQL   │    │  Email        │    │  Resend      │
│  (via db)     │    │  Notifications│    │  (Emails)    │
└───────────────┘    └───────────────┘    └───────────────┘
```

## Technology Stack

- **App Framework**: Next.js 16.0.10 (App Router)
- **Authentication**: Clerk (shared with apps/web, apps/marketing)
- **Database**: PostgreSQL with Drizzle ORM (via @mentorships/db)
- **UI Components**: @mentorships/ui
- **Short-term Storage**: Backblaze B2 + Cloudflare CDN (free egress)
- **Long-term Storage**: AWS S3 Glacier Deep Archive
- **Background Jobs**: Trigger.dev
- **Email**: Resend (shared with apps/web, apps/marketing)

---

## Phase 1: New App Setup

### 1.1 Create `apps/huckleberry-drive`

```bash
pnpm create next-app@latest apps/huckleberry-drive \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --use-pnpm
```

### 1.2 Directory Structure

```
apps/huckleberry-drive/
├── app/
│   ├── layout.tsx                    # RootLayout with ClerkProvider
│   ├── page.tsx                      # Redirect to /dashboard
│   ├── (auth)/
│   │   └── sign-in/[[...sign-in]]/page.tsx
│   ├── dashboard/
│   │   └── page.tsx                  # File list, storage usage
│   ├── uploads/
│   │   └── page.tsx                  # Upload interface
│   ├── admin/
│   │   ├── costs/
│   │   │   └── page.tsx              # Cost dashboard
│   │   └── page.tsx                  # Admin overview
│   └── api/
│       ├── uploads/
│       │   ├── initiate/route.ts
│       │   ├── complete/route.ts
│       │   └── abort/route.ts
│       ├── files/
│       │   ├── route.ts
│       │   └── [id]/route.ts
│       ├── download/[id]/route.ts
│       └── costs/route.ts
├── components/
│   ├── upload-zone.tsx
│   ├── file-list.tsx
│   ├── storage-usage.tsx
│   ├── cost-chart.tsx
│   └── ui/                           # @mentorships/ui
├── lib/
│   └── auth.ts
├── middleware.ts
├── package.json
├── tsconfig.json
└── next.config.ts
```

### 1.3 Dependencies

```json
{
  "dependencies": {
    "@clerk/nextjs": "^6.36.5",
    "@mentorships/db": "workspace:*",
    "@mentorships/ui": "workspace:*",
    "@mentorships/storage": "workspace:*",
    "@aws-sdk/client-s3": "^3.0.0",
    "@aws-sdk/s3-request-presigner": "^3.0.0",
    "@uppy/tus": "^4.0.0",
    "@uppy/react": "^4.0.0",
    "uppy": "^4.0.0",
    "recharts": "^2.0.0"
  }
}
```

### 1.4 Development Scripts (package.json root)

```json
{
  "scripts": {
    "dev:huckleberry": "pnpm --filter @mentorships/huckleberry-drive dev"
  }
}
```

---

## Phase 2: Authentication

### 2.1 Clerk Configuration

Add to Clerk Dashboard → Applications → Your App → Allowed origins:
- `http://localhost:3002` (development)
- `https://drive.huckleberry.art` (production)

### 2.2 Middleware

```typescript
// apps/huckleberry-drive/middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/api/webhooks(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
```

### 2.3 Auth Helpers

```typescript
// apps/huckleberry-drive/lib/auth.ts
import { auth } from "@clerk/nextjs/server";
import { getDbUser, UnauthorizedError, ForbiddenError } from "@mentorships/db";

export async function requireMentor() {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");
  
  const dbUser = await getDbUser(userId);
  if (!dbUser || (dbUser.role !== "mentor" && dbUser.role !== "admin")) {
    throw new ForbiddenError("Must be a mentor");
  }
  return dbUser;
}

export async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");
  
  const dbUser = await getDbUser(userId);
  if (!dbUser || dbUser.role !== "admin") {
    throw new ForbiddenError("Must be an admin");
  }
  return dbUser;
}

export async function canAccessFile(fileInstructorId: string) {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");
  
  const dbUser = await getDbUser(userId);
  if (!dbUser) throw new UnauthorizedError("User not found");
  
  // Admin can access all, mentors can only access their own
  if (dbUser.role === "admin") return true;
  if (dbUser.role === "mentor" && fileInstructorId === userId) return true;
  
  throw new ForbiddenError("Cannot access this file");
}
```

---

## Phase 3: Storage Package (`packages/storage`)

### 3.1 Package Structure

```
packages/storage/
├── src/
│   ├── client.ts              # B2 S3 client
│   ├── uploads.ts             # Multipart upload
│   ├── downloads.ts           # Presigned URLs
│   ├── files.ts               # File operations
│   ├── archive.ts             # B2 → S3 transfer
│   ├── costs.ts               # Cost tracking
│   └── index.ts               # Exports
├── package.json
└── tsconfig.json
```

### 3.2 B2 S3 Client

```typescript
// packages/storage/src/client.ts
import { S3Client } from "@aws-sdk/client-s3";

export function createB2Client() {
  return new S3Client({
    region: process.env.B2_REGION || "us-west-002",
    endpoint: `https://s3.${process.env.B2_REGION || "us-west-002"}.backblazeb2.com`,
    credentials: {
      accessKeyId: process.env.B2_KEY_ID!,
      secretAccessKey: process.env.B2_APPLICATION_KEY!,
    },
    forcePathStyle: true,
  });
}
```

### 3.3 Upload Functions

```typescript
// packages/storage/src/uploads.ts

export interface UploadInit {
  fileId: string;
  uploadId: string;
  partSize: number;
  partCount: number;
  presignedUrls: string[];
}

/**
 * Initiates multipart upload for large files (2-20GB)
 * Uses 100MB parts (max 200 parts per file)
 */
export async function initiateMultipartUpload(params: {
  fileId: string;
  filename: string;
  contentType: string;
  size: number;
  instructorId: string;
}): Promise<UploadInit>;

/**
 * Generates presigned URL for uploading a specific part
 */
export async function getPresignedPartUrl(params: {
  uploadId: string;
  partNumber: number;
}): Promise<string>;

/**
 * Completes multipart upload after all parts uploaded
 */
export async function completeMultipartUpload(params: {
  fileId: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}): Promise<void>;

/**
 * Aborts multipart upload (cleanup)
 */
export async function abortMultipartUpload(uploadId: string): Promise<void>;
```

### 3.4 Download Functions

```typescript
// packages/storage/src/downloads.ts

/**
 * Generates temporary download URL (default: 1 hour expiry)
 */
export async function getDownloadUrl(
  fileId: string,
  expiresInSeconds?: number
): Promise<string>;
```

### 3.5 File Operations

```typescript
// packages/storage/src/files.ts

/**
 * Lists files for an instructor (with pagination)
 */
export async function listInstructorFiles(
  instructorId: string,
  options?: { limit?: number; cursor?: string }
): Promise<{
  files: FileMetadata[];
  nextCursor?: string;
}>;

/**
 * Deletes a file (removes from B2/S3)
 */
export async function deleteFile(
  fileId: string,
  instructorId: string
): Promise<void>;

/**
 * Gets storage usage for an instructor
 */
export async function getStorageUsage(
  instructorId: string
): Promise<{
  usedBytes: number;
  fileCount: number;
  limitBytes: number;  // 20GB default
}>;
```

### 3.6 Archive Functions (B2 → S3)

```typescript
// packages/storage/src/archive.ts

/**
 * Copy file from B2 to AWS S3 Glacier Deep Archive
 */
export async function copyToS3(params: {
  fileId: string;
  b2FileId: string;
  filename: string;
}): Promise<{ s3Key: string; s3Url: string }>;

/**
 * Verify S3 upload completed
 */
export async function verifyS3Upload(s3Key: string): Promise<boolean>;

/**
 * Delete from B2 after S3 verification
 */
export async function deleteFromB2(b2FileId: string): Promise<void>;

/**
 * Notify instructor of archive completion
 */
export async function notifyInstructorOfArchive(params: {
  instructorId: string;
  filename: string;
  s3Url: string;
  originalUploadDate: Date;
}): Promise<void>;
```

### 3.7 Cost Functions

```typescript
// packages/storage/src/costs.ts

/**
 * Fetch current month's costs from B2 and S3
 */
export async function fetchMonthlyCosts(): Promise<{
  b2Storage: number;    // cents
  b2Download: number;
  s3Storage: number;
  s3Requests: number;
}>;

/**
 * Check threshold, send alert if exceeded
 */
export async function checkCostThreshold(
  month: string,
  thresholdCents?: number
): Promise<boolean>;

/**
 * Get historical costs
 */
export async function getHistoricalCosts(
  months?: number
): Promise<MonthlyCost[]>;
```

---

## Phase 4: Database Schema

> **Note**: Update existing `userRoleEnum` in `packages/db/src/schema/users.ts` to include "video_editor":
> ```typescript
> export const userRoleEnum = pgEnum("user_role", ["student", "mentor", "admin", "video_editor"]);
> ```
> Run migration to add the new role.

### 4.1 Instructor Uploads Table

```typescript
// packages/db/src/schema/instructorUploads.ts
import { pgTable, text, timestamp, integer, varchar, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";

export const uploadStatusEnum = pgEnum("upload_status", [
  "pending",    // Upload initiated, waiting for chunks
  "uploading",  // Active upload in progress
  "completed",  // Fully uploaded to B2, not yet archived
  "archived",   // Successfully archived to S3 Glacier Deep Archive
  "failed",     // Upload or archive failed
  "deleted",    // Soft deleted
]);

export const transferStatusEnum = pgEnum("transfer_status", [
  "pending",     // Not yet transferred to S3
  "transferring", // Currently copying to S3
  "completed",   // Successfully archived to S3
  "failed",      // Transfer failed, will retry
]);

// UI Status Display Logic:
// - status="completed" + transferStatus="pending" = 🟢 On B2
// - status="completed" + transferStatus="transferring" = 🟡 Archiving...
// - status="archived" + transferStatus="completed" = 🔵 Archived to Cloud
// - status="failed" OR transferStatus="failed" = 🔴 Archive Failed

export const instructorUploads = pgTable("instructor_uploads", {
  id: text("id").primaryKey(),  // UUID
  instructorId: text("instructor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  
  filename: varchar("filename", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),  // bytes
  
  // B2 storage
  b2FileId: text("b2_file_id"),
  b2UploadId: text("b2_upload_id"),
  b2PartEtags: text("b2_part_etags"),  // JSON
  
  // Status
  status: uploadStatusEnum("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  
  // Archive info
  archivedAt: timestamp("archived_at"),
  s3Key: text("s3_key"),
  s3Url: text("s3_url"),
  transferStatus: transferStatusEnum("transfer_status"),
  transferRetryCount: integer("transfer_retry_count").default(0),
  notifiedAt: timestamp("notified_at"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InstructorUpload = typeof instructorUploads.$inferSelect;
export type NewInstructorUpload = typeof instructorUploads.$inferInsert;
```

### 4.2 Monthly Storage Costs Table

```typescript
// packages/db/src/schema/monthlyStorageCosts.ts
import { pgTable, text, timestamp, integer, boolean, varchar } from "drizzle-orm/pg-core";

export const monthlyStorageCosts = pgTable("monthly_storage_costs", {
  id: text("id").primaryKey(),
  month: varchar("month", { length: 7 }).notNull(),  // "2026-03"
  
  b2StorageCost: integer("b2_storage_cost").notNull(),    // cents
  b2DownloadCost: integer("b2_download_cost").notNull(),
  b2ApiCost: integer("b2_api_cost").notNull(),
  
  s3StorageCost: integer("s3_storage_cost").notNull(),
  s3RetrievalCost: integer("s3_retrieval_cost").notNull(),
  
  totalCost: integer("total_cost").notNull(),
  
  alertSent: boolean("alert_sent").default(false),
  alertThreshold: integer("alert_threshold").default(5000),  // $50
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type MonthlyStorageCost = typeof monthlyStorageCosts.$inferSelect;
export type NewMonthlyStorageCost = typeof monthlyStorageCosts.$inferInsert;
```

---

## Phase 5: API Routes

### 5.1 Upload Endpoints

**POST /api/uploads/initiate**
- Validates file (type, size ≤20GB)
- Creates DB record
- Initiates B2 multipart upload
- Returns: uploadId, partSize, presignedUrls[]

**POST /api/uploads/complete**
- Verifies all parts uploaded
- Completes B2 multipart upload
- Updates DB status to "completed"

**POST /api/uploads/abort**
- Cancels multipart upload
- Cleans up DB records

### 5.2 File Endpoints

**GET /api/files**
- Lists instructor's files
- Pagination support

**DELETE /api/files/[id]**
- Soft deletes file
- Removes from B2/S3

### 5.3 Download Endpoints

**GET /api/download/[id]**
- Generates presigned URL
- Validates access (owner or admin)
- Returns: { url } (expires 1 hour)

### 5.4 Cost Endpoints

**GET /api/costs**
- Returns current month costs
- Historical costs

**POST /api/costs/refresh**
- Manually refresh cost data
- Triggers B2/S3 API calls

---

## Phase 6: Background Jobs (Trigger.dev)

### 6.1 Archive Job

> **Important**: Files are NOT deleted from B2 automatically. They remain on B2 until manually deleted by admin. This allows:
> - Instructors to download files locally anytime
> - Backup redundancy between B2 and S3
> - Manual cleanup when storage costs require it

```typescript
// Runs daily at 3:00 AM UTC
export const archiveOldFiles = schedules.task({
  id: "archive-old-files",
  cron: "0 3 * * *",  // Daily at 3 AM UTC
  run: async () => {
    // Find files older than 30 days not yet archived
    const files = await findFilesForArchiving(30);
    
    for (const file of files) {
      try {
        // 1. Copy from B2 to S3 Glacier Deep Archive
        const { s3Key, s3Url } = await copyToS3({ fileId: file.id, ... });
        
        // 2. Verify S3 upload completed
        const verified = await verifyS3Upload(s3Key);
        if (!verified) throw new Error("S3 verification failed");
        
        // 3. Update database (status = "archived", store s3Url)
        // NOTE: File remains on B2 - NOT deleted automatically
        await updateFileStatus(file.id, "archived", s3Url);
        
        // 4. Notify instructor via email
        await notifyInstructorOfArchive({ 
          instructorId: file.instructorId,
          filename: file.filename,
          s3Url,
          downloadB2Url: `/download/${file.id}`, // Link to download from B2 before 30 days
        });
      } catch (error) {
        await handleTransferFailure(file, error);
      }
    }
  },
});
```

### 6.1.2 Manual B2 Cleanup (Admin Only)

After confirming files are successfully archived to S3, admins can manually delete B2 copies to reduce storage costs:

```typescript
// Admin API to delete B2 copy after S3 archival
// Only available for files where status = "archived"
export async function deleteB2Copy(fileId: string, adminId: string): Promise<void>;
```

Admin UI: `/admin/storage` - shows archived files with "Delete B2 Copy" button

Before files reach 30 days, send a reminder email so instructors can download locally:

```typescript
// Runs daily at 9 AM UTC
export const sendArchiveWarnings = schedules.task({
  id: "send-archive-warnings",
  cron: "0 9 * * *",
  run: async () => {
    // Find files that will be archived in 7 days
    const files = await findFilesNearingArchive(7);
    
    for (const file of files) {
      await sendArchiveWarningEmail({
        to: file.instructorEmail,
        filename: file.filename,
        daysUntilArchive: 7,
        downloadLink: `/download/${file.id}`,
      });
    }
  },
});
```
        await handleTransferFailure(file, error);
      }
    }
  },
});
```

### 6.2 Cost Calculation Job

```typescript
// Runs daily at 2:00 AM UTC
export const calculateDailyCosts = schedules.task({
  id: "calculate-daily-costs",
  cron: "0 2 * * *",
  run: async () => {
    const costs = await fetchMonthlyCosts();
    await updateMonthlyCosts(costs);
    
    // Check threshold
    if (costs.total > 5000) {  // $50
      await sendCostAlertEmail(costs);
    }
  },
});
```

### 6.3 Retry Failed Transfers

```typescript
// Runs every 6 hours
export const retryFailedTransfers = schedules.task({
  id: "retry-failed-transfers",
  cron: "0 */6 * * *",  // Every 6 hours
  run: async () => {
    const failedFiles = await getFailedTransfers();
    
    for (const file of failedFiles) {
      if (file.transferRetryCount < 4) {
        await retryArchive(file);
      } else {
        await alertAdminOfFailure(file);
      }
    }
  },
});
```

---

## Phase 7: Frontend Features

### 7.1 Upload Page (/uploads)

- Drag-and-drop zone (Uppy with Tus plugin)
- Direct upload to B2 (bypasses server)
- File validation (type: video/*, size: ≤20GB)
- Upload progress (per-file and overall)
- Pause/resume upload capability
- Cancel upload button
- Error display
- Max 2 concurrent uploads

### 7.2 Dashboard (/dashboard)

- File list table
- Columns: filename, size, date, **status**, actions
- Status indicators:
  - 🟢 **On B2** - File is on Backblaze B2 only
  - 🔵 **Archived to Cloud** - File copied to S3 Glacier Deep Archive (B2 + S3)
  - 🟡 **Archiving...** - Currently being copied to S3
  - 🔴 **Archive Failed** - Transfer failed, retry scheduled
- Download button
- Delete button (with confirmation)
- Storage usage bar (used / 20GB limit)

### 7.3 Admin Costs Page (/admin/costs)

- Monthly cost chart (bar chart)
- Breakdown: B2 storage, B2 download, S3 storage
- Historical table
- Current month vs previous months
- Alert threshold indicator

---

## Phase 8: Environment Variables

### Development (.env.local)

```env
# Clerk (shared)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx

# App
INSTRUCTOR_PORTAL_URL=http://localhost:3002

# Backblaze B2 (short-term)
B2_KEY_ID=your_key_id
B2_APPLICATION_KEY=your_application_key
B2_BUCKET_ID=your_bucket_id
B2_BUCKET_NAME=instructor-uploads
B2_REGION=us-west-002

# Cloudflare CDN (free egress from B2)
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_PUBLIC_URL=https://files.drive.huckleberry.art

# AWS S3 (long-term archive)
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_S3_BUCKET=instructor-uploads-archive
AWS_S3_REGION=us-east-1

# Email (Resend)
RESEND_API_KEY=re_xxx

# Transfer settings
B2_TO_S3_DAYS=30
MAX_UPLOAD_SIZE_BYTES=21474836440  # 20GB
UPLOAD_TIMEOUT_HOURS=24
CONCURRENT_UPLOADS=2
PART_SIZE_BYTES=104857600  # 100MB
```

---

## Phase 9: Deployment

1. **Create Vercel project** for huckleberry-drive
2. **Add environment variables** in Vercel
3. **Configure domain** (e.g., `drive.huckleberry.art`)
4. **Add domain to Clerk** allowed origins
5. **Configure Backblaze B2** bucket (CORS settings)
6. **Configure AWS S3** bucket (permissions)
7. **Deploy Trigger.dev** functions

---

## Access Control Matrix

| User Role | View Assigned Files | View All Files | Download | Delete (Own) | Delete B2 After Archive | Upload | View Costs |
|-----------|---------------------|----------------|----------|--------------|-------------------------|--------|------------|
| **Instructor** | Own files only | ✗ | Own only | Own only | ✗ | ✓ | Own only |
| **Video Editor** | Assigned instructors' files | ✗ | Assigned only | ✗ | ✗ | ✓ | ✗ |
| **Admin** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (all) |

**Delete (Own)**: Remove file entirely from B2/S3
**Delete B2 After Archive**: Admin can delete B2 copy after confirming S3 archive

---

## Video Editor Workflow

### Assignment System
- Admins assign video editors to specific instructors
- A video editor can be assigned to multiple instructors
- Video editors can only see/upload files from/to their assigned instructors
- Video editors upload draft edits and final video files

### Database Schema Addition

```typescript
// packages/db/src/schema/videoEditorAssignments.ts
export const videoEditorAssignments = pgTable("video_editor_assignments", {
  id: text("id").primaryKey(),
  videoEditorId: text("video_editor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  instructorId: text("instructor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  assignedBy: text("assigned_by")
    .notNull()
    .references(() => users.id),
});

export type VideoEditorAssignment = typeof videoEditorAssignments.$inferSelect;
```

### Auth Helpers Addition

```typescript
// apps/huckleberry-drive/lib/auth.ts

export async function getAssignedInstructorIds(): Promise<string[]> {
  const { userId } = await auth();
  if (!userId) return [];
  
  const dbUser = await getDbUser(userId);
  if (!dbUser) return [];
  
  if (dbUser.role === "admin") {
    // Admin can access all instructors
    return [];
  }
  
  if (dbUser.role === "mentor") {
    // Instructor can only see own files
    return [userId];
  }
  
  if (dbUser.role === "video_editor") {
    // Get assigned instructor IDs
    const assignments = await getVideoEditorAssignments(userId);
    return assignments.map(a => a.instructorId);
  }
  
  return [];
}
```

### File Listing Logic

```typescript
// In listInstructorFiles - updated to filter by assignment
export async function listAccessibleFiles(userId: string) {
  const dbUser = await getDbUser(userId);
  
  if (dbUser.role === "admin") {
    return listAllFiles();
  }
  
  if (dbUser.role === "mentor") {
    return listInstructorFiles(userId);
  }
  
  if (dbUser.role === "video_editor") {
    const assignedInstructors = await getAssignedInstructorIds();
    return listFilesForInstructors(assignedInstructors);
  }
  
  return [];
}
```

---

### Admin UI - Assignment Management

```typescript
// apps/huckleberry-drive/app/admin/assignments/page.tsx
// - List all video editors
// - List all instructors
// - Assign/remove video editors to instructors
// - View current assignments
```

---

## Cost Estimates

### Backblaze B2 + Cloudflare CDN (Short-term, 30 days)
- Storage: ~$0.006/GB/month
- Download/Egress: **FREE** (via Cloudflare Bandwidth Alliance)
- B2 Class A transactions: ~$0.004/1000 (upload)
- B2 Class B transactions: ~$0.002/1000 (download via CDN)

### AWS S3 Glacier Deep Archive (Long-term)
- Storage: ~$0.00099/GB/month (~$1/GB/year)
- Retrieval: $0.02/GB + request fees

### Example: 100GB instructor uploads/month
- B2 storage (30 days): ~$0.06/month
- B2 transactions: ~$0.02/month
- Cloudflare egress: **FREE**
- S3 Archive (335 days): ~$0.33/month
- **Total: ~$0.41/month for 100GB**

---

## Files to Create/Modify

### New Files
- `apps/huckleberry-drive/*` - New Next.js app
- `packages/storage/*` - New storage package
- `packages/db/src/schema/instructorUploads.ts` - DB schema
- `packages/db/src/schema/monthlyStorageCosts.ts` - Cost schema
- `packages/db/src/schema/videoEditorAssignments.ts` - DB schema
- `.env` updates

### Existing Files to Modify
- `package.json` - Add dev script
- `packages/db/src/schema/users.ts` - Add "video_editor" to userRoleEnum
- `packages/db/src/schema/index.ts` - Export new schemas
- `packages/db/src/index.ts` - Export new functions

---

## Appendix A: Updated Upload Patterns (Context7 Best Practices 2026)

### A.1 Recommended Architecture: Client → Storage → CDN

```
Client (Uppy/TUS) → Backblaze B2 (Direct Upload) → Cloudflare CDN → User
                     ↑                              ↑
              Server generates               Files served via CDN
              presigned URLs                  (free egress)
```

**Key Principle**: Server never touches the file directly. Client uploads to B2 via presigned URLs, server only manages metadata.

### A.2 Uppy + TUS Implementation

For 2-20GB video files, use TUS protocol for resumable uploads:

```typescript
// apps/huckleberry-drive/components/upload-zone.tsx
import Uppy from "@uppy/core";
import Tus from "@uppy/tus";

const uppy = new Uppy({
  restrictions: {
    maxFileSize: 20 * 1024 * 1024 * 1024, // 20GB
    allowedFileTypes: ["video/*"],
    maxConcurrentUploads: 2,
  },
});

uppy.use(Tus, {
  endpoint: "/api/uploads/tus", // TUS endpoint
  chunkSize: 8 * 1024 * 1024, // 8MB chunks
  retryDelays: [0, 1000, 3000, 5000, 10000],
  
  // Dynamic upload URL from server
  async uploadUrl(file) {
    const response = await fetch("/api/uploads/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        size: file.size,
        type: file.type,
      }),
    });
    const { uploadUrl } = await response.json();
    return uploadUrl;
  },
  
  // Track progress
  onProgress: (bytesUploaded, bytesTotal) => {
    const progress = (bytesUploaded / bytesTotal) * 100;
    console.log(`${progress.toFixed(1)}% uploaded`);
  },
});
```

### A.3 TUS Server Endpoint (Next.js Route Handler)

```typescript
// apps/huckleberry-drive/app/api/uploads/tus/route.ts
import { NextRequest } from "next/server";

// TUS protocol endpoints
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Tus-Resumable": "1.0.0",
      "Tus-Version": "1.0.0",
      "Tus-Extension": "creation,termination",
      "Tus-Max-Size": String(20 * 1024 * 1024 * 1024),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, HEAD, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Tus-Resumable, Upload-Length, Upload-Metadata, Upload-Offset, Content-Type",
    },
  });
}

export async function HEAD(request: NextRequest) {
  // Return current offset for resume
  const uploadId = request.headers.get("Upload-Metadata");
  // Look up upload state from database
  const upload = await getUploadByMetadata(uploadId);
  
  return new Response(null, {
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Offset": String(upload.offset),
      "Cache-Control": "no-store",
    },
  });
}

export async function PATCH(request: NextRequest) {
  const uploadId = request.headers.get("Upload-Metadata");
  const contentType = request.headers.get("Content-Type");
  
  if (contentType !== "application/offset+octet-stream") {
    return new Response("Invalid Content-Type", { status: 415 });
  }
  
  // Read chunk and upload to B2
  const chunk = await request.arrayBuffer();
  const offset = await uploadChunkToB2(uploadId, chunk);
  
  return new Response(null, {
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Offset": String(offset),
      "Cache-Control": "no-store",
    },
  });
}
```

### A.4 Presigned URL Generation (Alternative for Direct B2)

```typescript
// apps/huckleberry-drive/app/api/uploads/initiate/route.ts
export async function POST(request: NextRequest) {
  const { userId } = await requireMentor();
  const { filename, size, type } = await request.json();
  
  // Validate
  if (size > 20 * 1024 * 1024 * 1024) {
    return Response.json({ error: "File too large" }, { status: 400 });
  }
  
  if (!type.startsWith("video/")) {
    return Response.json({ error: "Only video files allowed" }, { status: 400 });
  }
  
  // Create DB record
  const uploadId = crypto.randomUUID();
  await db.insert(instructorUploads).values({
    id: uploadId,
    instructorId: userId,
    filename,
    originalName: filename,
    contentType: type,
    size,
    status: "pending",
  });
  
  // Generate presigned URLs for B2 multipart upload
  const { uploadId: b2UploadId, presignedUrls } = await initiateB2Multipart({
    filename,
    contentType: type,
    size,
  });
  
  // Store B2 upload ID
  await db.update(instructorUploads)
    .set({ b2UploadId, status: "uploading" })
    .where(eq(instructorUploads.id, uploadId));
  
  return Response.json({
    uploadId,
    b2UploadId,
    partSize: 100 * 1024 * 1024, // 100MB
    presignedUrls,
  });
}
```

### A.5 Server Never Stores Files

> **Critical**: Never write uploaded files to the Next.js server's filesystem.

```typescript
// ❌ WRONG - Don't do this
export async function uploadFile(formData: FormData) {
  const file = formData.get("file") as File;
  await writeFile(`/tmp/${file.name}`, file);
}

// ✅ CORRECT - Stream directly to B2 or use presigned URLs
export async function initiateUpload() {
  // Server only generates presigned URLs
  // Client uploads directly to B2
}
```

---

## Appendix B: Trigger.dev v4 Enhanced Patterns

### B.1 Idempotent Archive Task

```typescript
// trigger/tasks/archive.ts
import { task, logger } from "@trigger.dev/sdk";
import { z } from "zod";

export const archiveFileTask = task({
  id: "archive-file",
  
  // Retry with exponential backoff
  retry: {
    maxAttempts: 5,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 60_000,
    factor: 2,
    randomize: false,
  },
  
  // Idempotency key based on file ID
  // Safe to retry without side effects
  run: async (payload: { fileId: string }) => {
    const { fileId } = payload;
    
    // Check if already archived (idempotency)
    const file = await getUploadById(fileId);
    if (file.status === "archived" && file.transferStatus === "completed") {
      logger.info(`File ${fileId} already archived, skipping`);
      return { skipped: true, reason: "already_archived" };
    }
    
    try {
      // 1. Copy from B2 to S3 Glacier Deep Archive
      logger.info(`Starting archive for file ${fileId}`);
      const { s3Key } = await copyToS3({
        fileId,
        b2FileId: file.b2FileId!,
        filename: file.filename,
      });
      
      // 2. Verify S3 upload
      const verified = await verifyS3Upload(s3Key);
      if (!verified) {
        throw new Error(`S3 verification failed for ${s3Key}`);
      }
      
      // 3. Update database atomically
      await db.update(instructorUploads)
        .set({
          status: "archived",
          transferStatus: "completed",
          archivedAt: new Date(),
          s3Key,
          s3Url: `s3://bucket/${s3Key}`,
          updatedAt: new Date(),
        })
        .where(eq(instructorUploads.id, fileId));
      
      // 4. Notify instructor
      await notifyInstructorOfArchive({
        instructorId: file.instructorId,
        filename: file.filename,
        s3Url: `s3://bucket/${s3Key}`,
      });
      
      return { success: true, s3Key };
    } catch (error) {
      logger.error(`Archive failed for file ${fileId}`, { error });
      throw error; // Will trigger retry
    }
  },
  
  // Cleanup on permanent failure
  onFailure: async ({ payload, error }) => {
    await db.update(instructorUploads)
      .set({
        status: "failed",
        errorMessage: error.message,
        transferRetryCount: sql`transfer_retry_count + 1`,
      })
      .where(eq(instructorUploads.id, payload.fileId));
    
    // Alert admin via observability
    await reportError("archive_failure", {
      fileId: payload.fileId,
      error: error.message,
    });
  },
});
```

### B.2 Scheduled Archive Job

```typescript
// trigger/schedules/archive.ts
import { schedules, logger } from "@trigger.dev/sdk";
import { archiveFileTask } from "../tasks/archive";

schedules.task({
  id: "daily-archive-check",
  cron: "0 3 * * *", // 3 AM UTC daily
  timezone: "UTC",
  run: async (payload) => {
    logger.info("Starting daily archive check");
    
    // Find files older than 30 days not yet archived
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    
    const filesToArchive = await db.select()
      .from(instructorUploads)
      .where(
        and(
          eq(instructorUploads.status, "completed"),
          or(
            isNull(instructorUploads.transferStatus),
            neq(instructorUploads.transferStatus, "completed"),
          ),
          lt(instructorUploads.createdAt, cutoffDate),
        )
      )
      .limit(100); // Process in batches
    
    logger.info(`Found ${filesToArchive.length} files to archive`);
    
    // Trigger archive tasks in parallel (with concurrency control)
    const results = [];
    for (const file of filesToArchive) {
      const handle = await archiveFileTask.trigger(
        { fileId: file.id },
        { idempotencyKey: `archive-${file.id}-${file.updatedAt?.getTime()}` }
      );
      results.push(handle);
    }
    
    return {
      queued: results.length,
      runIds: results.map(r => r.id),
    };
  },
});
```

### B.3 Cost Calculation with Error Handling

```typescript
// trigger/tasks/calculateCosts.ts
import { task, logger } from "@trigger.dev/sdk";

export const calculateMonthlyCostsTask = task({
  id: "calculate-monthly-costs",
  
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30000,
    factor: 2,
  },
  
  run: async (payload: { month?: string }) => {
    const month = payload.month || format(new Date(), "yyyy-MM");
    
    // Fetch costs from providers (may fail)
    const [b2Costs, s3Costs] = await Promise.all([
      fetchB2Costs(month).catch(e => {
        logger.error("B2 cost fetch failed", { error: e });
        return { storage: 0, download: 0, api: 0 };
      }),
      fetchS3Costs(month).catch(e => {
        logger.error("S3 cost fetch failed", { error: e });
        return { storage: 0, retrieval: 0 };
      }),
    ]);
    
    const total = 
      b2Costs.storage + b2Costs.download + b2Costs.api +
      s3Costs.storage + s3Costs.retrieval;
    
    // Upsert cost record
    await db.insert(monthlyStorageCosts)
      .values({
        id: crypto.randomUUID(),
        month,
        b2StorageCost: b2Costs.storage,
        b2DownloadCost: b2Costs.download,
        b2ApiCost: b2Costs.api,
        s3StorageCost: s3Costs.storage,
        s3RetrievalCost: s3Costs.retrieval,
        totalCost: total,
      })
      .onConflictDoUpdate({
        target: monthlyStorageCosts.month,
        set: {
          b2StorageCost: b2Costs.storage,
          b2DownloadCost: b2Costs.download,
          b2ApiCost: b2Costs.api,
          s3StorageCost: s3Costs.storage,
          s3RetrievalCost: s3Costs.retrieval,
          totalCost: total,
          updatedAt: new Date(),
        },
      });
    
    // Check threshold and alert
    if (total > 5000) { // $50
      await sendCostAlertEmail({
        month,
        total,
        breakdown: { b2Costs, s3Costs },
      });
    }
    
    return { month, total };
  },
});
```

---

## Appendix C: Security Best Practices

### C.1 File Upload Security

```typescript
// Validate uploads server-side
async function validateUpload(file: File, userId: string) {
  // 1. Check file type
  const allowedTypes = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"];
  if (!allowedTypes.includes(file.type)) {
    throw new Error("Invalid file type");
  }
  
  // 2. Check file size
  const maxSize = 20 * 1024 * 1024 * 1024; // 20GB
  if (file.size > maxSize) {
    throw new Error("File too large");
  }
  
  // 3. Check user's storage quota
  const usage = await getStorageUsage(userId);
  if (usage.usedBytes + file.size > usage.limitBytes) {
    throw new Error("Storage quota exceeded");
  }
  
  // 4. Verify authentication
  const { userId: authenticatedUserId } = await auth();
  if (authenticatedUserId !== userId) {
    throw new Error("Unauthorized");
  }
  
  // 5. Sanitize filename
  const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  
  return { sanitizedFilename };
}
```

### C.2 Download Access Control

```typescript
// apps/huckleberry-drive/app/api/download/[id]/route.ts
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  const file = await getUploadById(params.id);
  
  if (!file) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  
  const dbUser = await getDbUser(userId);
  
  // Access check
  if (dbUser.role === "admin") {
    // Admin can access all
  } else if (dbUser.role === "mentor" && file.instructorId === userId) {
    // Instructor can access own files
  } else if (dbUser.role === "video_editor") {
    // Video editor can access assigned instructor's files
    const assignments = await getVideoEditorAssignments(userId);
    if (!assignments.some(a => a.instructorId === file.instructorId)) {
      return Response.json({ error: "Not authorized" }, { status: 403 });
    }
  } else {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }
  
  // Generate short-lived presigned URL (1 hour)
  const downloadUrl = await getB2DownloadUrl(file.b2FileId, 3600);
  
  // Log download for audit
  await logDownload({ fileId: params.id, userId, timestamp: new Date() });
  
  return Response.json({ url: downloadUrl });
}
```

---

## Appendix D: Observability & Monitoring

### D.1 Structured Logging

```typescript
// apps/huckleberry-drive/lib/observability.ts
import { logger } from "@trigger.dev/sdk";

export const uploadLogger = {
  initiated: (fileId: string, instructorId: string, size: number) => {
    logger.info("Upload initiated", {
      fileId,
      instructorId,
      sizeBytes: size,
      event: "upload_initiated",
    });
  },
  
  completed: (fileId: string, duration: number) => {
    logger.info("Upload completed", {
      fileId,
      durationMs: duration,
      event: "upload_completed",
    });
  },
  
  failed: (fileId: string, error: string) => {
    logger.error("Upload failed", {
      fileId,
      error,
      event: "upload_failed",
    });
  },
};

export const archiveLogger = {
  started: (fileId: string) => {
    logger.info("Archive started", { fileId, event: "archive_started" });
  },
  
  completed: (fileId: string, s3Key: string) => {
    logger.info("Archive completed", {
      fileId,
      s3Key,
      event: "archive_completed",
    });
  },
  
  failed: (fileId: string, error: string, attempt: number) => {
    logger.error("Archive failed", {
      fileId,
      error,
      attempt,
      event: "archive_failed",
    });
  },
};
```

### D.2 Metrics to Track

```typescript
// Key metrics for monitoring
const METRICS = {
  // Upload metrics
  uploadCount: "instructor_upload_count",
  uploadSizeBytes: "instructor_upload_size_bytes",
  uploadDurationMs: "instructor_upload_duration_ms",
  uploadFailureCount: "instructor_upload_failure_count",
  
  // Archive metrics
  archiveQueueSize: "instructor_archive_queue_size",
  archiveLatencyMs: "instructor_archive_latency_ms",
  archiveFailureCount: "instructor_archive_failure_count",
  archiveStorageBytes: "instructor_archive_storage_bytes",
  
  // Cost metrics
  b2StorageCost: "b2_storage_cost_cents",
  b2DownloadCost: "b2_download_cost_cents",
  s3StorageCost: "s3_storage_cost_cents",
  
  // User metrics
  activeInstructors: "active_instructors",
  storageQuotaUsage: "storage_quota_usage_percent",
};
```

---

## Appendix E: Environment Variables (Updated)

```env
# Backblaze B2 (Direct Upload)
B2_KEY_ID=your_key_id
B2_APPLICATION_KEY=your_application_key
B2_BUCKET_ID=your_bucket_id
B2_BUCKET_NAME=instructor-uploads
B2_REGION=us-west-002

# Cloudflare CDN (Free Egress from B2)
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_R2_ACCOUNT_ID=your_r2_account_id
CLOUDFLARE_PUBLIC_URL=https://files.drive.huckleberry.art

# AWS S3 Glacier Deep Archive
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_S3_BUCKET=instructor-uploads-archive
AWS_S3_REGION=us-east-1

# Trigger.dev
TRIGGER_API_KEY=tr_xxx
TRIGGER_SECRET_KEY=ts_xxx

# Upload Limits
MAX_UPLOAD_SIZE_BYTES=21474836440
MAX_CONCURRENT_UPLOADS=2
UPLOAD_CHUNK_SIZE_BYTES=8388608
ARCHIVE_DAYS_THRESHOLD=30

# Storage Quotas (per instructor)
DEFAULT_STORAGE_LIMIT_BYTES=21474836480  # 20GB
```

---

## Appendix F: Performance Considerations

### F.1 Upload Performance

- **Chunk Size**: 8MB for TUS uploads (balance between progress granularity and HTTP overhead)
- **Concurrent Uploads**: 2 files simultaneously per user
- **B2 Part Size**: 100MB for multipart uploads (max 200 parts = 20GB)
- **Presigned URL Expiry**: 1 hour for upload URLs

### F.2 Archive Performance

- **Batch Size**: Process 100 files per cron run
- **Retry Backoff**: Exponential with max 5 attempts
- **Concurrency**: Limit S3 Glacier operations to avoid throttling

### F.3 CDN Caching

- **Static Assets**: Cache indefinitely (immutable)
- **Presigned Downloads**: 1-hour expiry
- **File Listings**: No cache (always fresh)

---

(End of file - additions from Context7 best practices)

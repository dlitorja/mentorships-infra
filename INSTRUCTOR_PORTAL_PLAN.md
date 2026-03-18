# Huckleberry Drive Implementation Plan

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

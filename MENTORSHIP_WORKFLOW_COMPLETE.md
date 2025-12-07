# Mentorship Payment & Booking Workflow - Complete Specification

## 1. Core Business Model

### Session Pack Model
- Each purchase = 4 sessions
- Fixed validity window (30-45 days from purchase)
- Multiple packs can stack with same mentor (sessions combine, one seat per mentor)
- No auto-renewal - manual repurchase required

### Seat Reservation Model
- **One seat per student per mentor** (regardless of pack count)
- Seats do NOT expire (no `seatExpiresAt` expiration logic)
- Seats released when:
  - All sessions completed + 72-hour grace period ends, OR
  - Pack refunded, OR
  - Manual release by admin/mentor
- Capacity enforcement: Block purchase if mentor at `maxActiveStudents` limit

### Onboarding Requirements
- **Must complete before booking any sessions:**
  1. Complete user profile (bio, preferences, goals)
  2. Connect Google Calendar
  3. Set session preferences (time zones, availability)
  4. Set mentorship goals/objectives
- Tracked via `onboarding_completed_at` timestamp
- Visible in instructor and admin dashboards
- Email follow-up: 24 hours after purchase if incomplete

---

## 2. Payment Checkout Flow

### Step-by-Step Process

**1. User Initiates Purchase**
- User selects mentor and session pack from `mentorship_products` table
- Frontend checks: Is mentor at capacity? (Show sold out if yes)
- User clicks "Purchase" button

**2. Pre-Purchase Validation** (`POST /api/checkout/stripe` or `/api/checkout/paypal`)
- ✅ Verify user authenticated (Clerk)
- ✅ Check mentor seat availability:
  ```typescript
  const availability = await checkSeatAvailability(mentorId);
  if (!availability.hasAvailability) {
    return error("Mentor is at capacity - no seats available");
  }
  ```
- ✅ Get pack details from `mentorship_products`
- ✅ Create `order` record (status: `pending`, provider: `stripe` or `paypal`)

**3. Create Payment Provider Session**
- Stripe: Create Checkout Session with metadata:
  ```typescript
  metadata: {
    order_id: order.id,
    user_id: userId,
    pack_id: packId,
    mentor_id: mentorId
  }
  ```
- PayPal: Create Order with similar metadata
- Return checkout URL to frontend

**4. User Completes Payment**
- Redirected to provider-hosted checkout
- User enters payment details (PCI compliant - handled by provider)
- Provider processes payment

**5. Webhook Received** (`POST /api/webhooks/stripe` or `/api/webhooks/paypal`)
- ✅ Verify webhook signature (CRITICAL for security)
- ✅ Check idempotency (prevent duplicate processing)
- ✅ Extract `order_id` from metadata
- ✅ Update `order` status: `pending` → `paid`
- ✅ Create `payment` record (status: `completed`)
- ✅ Create `session_pack`:
  ```typescript
  {
    userId,
    mentorId,
    totalSessions: 4,
    remainingSessions: 4,
    expiresAt: now + pack.validityDays,
    status: 'active',
    paymentId
  }
  ```
- ✅ Create `seat_reservation`:
  ```typescript
  {
    userId,
    mentorId,
    sessionPackId,
    status: 'active',
    // NO seatExpiresAt - seats don't expire
  }
  ```
- ✅ Send notifications (Discord bot, email)
- ✅ Trigger onboarding email sequence

**6. Post-Payment Actions**
- User redirected to success page
- Show onboarding checklist if incomplete
- Enable booking UI once onboarding complete

---

## 3. Onboarding Flow

### Onboarding State Tracking

**Database Schema Addition:**
```typescript
// Add to users table or create onboarding_status table
onboarding_completed_at: timestamp | null
onboarding_steps: {
  profile_complete: boolean
  calendar_connected: boolean
  preferences_set: boolean
  goals_set: boolean
}
```

### Onboarding Completion Check
```typescript
function isOnboardingComplete(userId: string): boolean {
  return (
    onboarding.profile_complete &&
    onboarding.calendar_connected &&
    onboarding.preferences_set &&
    onboarding.goals_set
  );
}
```

### Booking Eligibility
```typescript
async function canBookSession(userId: string, mentorId: string) {
  // 1. Check onboarding
  if (!isOnboardingComplete(userId)) {
    return { canBook: false, reason: "Onboarding incomplete" };
  }
  
  // 2. Check active session pack
  const pack = await getActiveSessionPack(userId, mentorId);
  if (!pack || pack.remainingSessions <= 0) {
    return { canBook: false, reason: "No active pack or sessions remaining" };
  }
  
  // 3. Check pack expiration
  if (pack.expiresAt < new Date()) {
    return { canBook: false, reason: "Pack expired" };
  }
  
  // 4. Check seat status
  const seat = await getActiveSeatReservation(userId, mentorId);
  if (!seat || seat.status !== 'active') {
    return { canBook: false, reason: "No active seat reservation" };
  }
  
  return { canBook: true, sessionPack: pack };
}
```

### Email Follow-Up Schedule
- **Immediate**: Welcome email with onboarding checklist
- **24 hours**: Reminder if onboarding incomplete
- **48 hours**: Second reminder if still incomplete
- **Weekly**: Continue reminders until completed

---

## 4. Booking Flow

### Session Booking Process

**1. Pre-Booking Checks** (`POST /api/sessions/book`)
- ✅ Verify user authenticated
- ✅ Check `canBookSession()` (onboarding + pack + seat)
- ✅ Validate requested time slot (mentor availability)
- ✅ Check 24-hour minimum notice requirement

**2. Create Session**
```typescript
const session = await createSession({
  mentorId,
  studentId: userId,
  sessionPackId: pack.id,
  scheduledAt: requestedTime,
  status: 'scheduled'
});
```

**3. Decrement Session Pack**
```typescript
await decrementSessionPack(pack.id);
// Updates remainingSessions and status if depleted
```

**4. Create Google Calendar Event** (if mentor has calendar connected)
- Create event via Google Calendar API
- Store `googleCalendarEventId` in session record

**5. Send Notifications**
- Discord: Notify mentor and student
- Email: Confirmation to both parties

---

## 5. Session Completion & Seat Release

### When Session is Completed

**1. Update Session Status**
```typescript
await updateSession({
  id: sessionId,
  status: 'completed',
  completedAt: new Date()
});
```

**2. Calculate Session Number**
```typescript
const completedSessions = await db
  .select({ count: count() })
  .from(sessions)
  .where(
    and(
      eq(sessions.sessionPackId, pack.id),
      eq(sessions.status, 'completed')
    )
  );

const sessionNumber = completedSessions.count;
```

**3. Send Session Completion Email** (Immediate)

- **Session 3 Email:**
  - Subject: "Session 3 Complete - Renewal Reminder"
  - Content:
    - Thank you for completing session 3
    - Reminder: Only 1 session remaining
    - Renew now to keep your seat (link to purchase page)
    - **Request testimonial** (link to testimonial submission page: `/testimonials/submit?mentor={mentorId}&sessionPack={packId}`)

- **Session 4 Email:**
  - Subject: "Session 4 Complete - Renew to Keep Your Seat"
  - Content:
    - Thank you for completing all 4 sessions
    - Your seat will be released in 72 hours if not renewed
    - Renew now to continue (link to purchase page)
    - **Request testimonial** (link to testimonial submission page: `/testimonials/submit?mentor={mentorId}&sessionPack={packId}`)

**4. Check if Pack Depleted**
```typescript
if (pack.remainingSessions === 0) {
  // Start grace period
  await updateSeatReservation({
    id: seatId,
    status: 'grace',
    gracePeriodEndsAt: new Date(Date.now() + 72 * 60 * 60 * 1000)
  });
  
  // Final renewal reminder already sent in step 3
}
```

**5. Grace Period Management** (Scheduled Job - runs hourly)
```typescript
async function handleGracePeriod() {
  // Find seats in grace where gracePeriodEndsAt < now
  const expiredGraceSeats = await db
    .select()
    .from(seatReservations)
    .where(
      and(
        eq(seatReservations.status, 'grace'),
        lte(seatReservations.gracePeriodEndsAt, new Date())
      )
    );
  
  // Release seats
  for (const seat of expiredGraceSeats) {
    await releaseSeat(seat.id);
    // Send notification: Seat released, mentor can accept new student
  }
}
```

**6. Renewal During Grace Period**
- If user purchases new pack during grace period:
  - Extend grace period (reset to 72 hours)
  - Add new sessions to existing pack (stacking)
  - Keep seat in `active` status

---

## 6. Testimonial System

### Database Schema

```typescript
// New table: testimonials
export const testimonialStatusEnum = pgEnum("testimonial_status", [
  "pending",
  "approved", 
  "rejected"
]);

export const testimonials = pgTable("testimonials", {
  id: uuid("id").primaryKey().defaultRandom(),
  mentorId: uuid("mentor_id")
    .notNull()
    .references(() => mentors.id, { onDelete: "cascade" }),
  studentId: text("student_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionPackId: uuid("session_pack_id")
    .references(() => sessionPacks.id, { onDelete: "set null" }),
  testimonialText: text("testimonial_text").notNull(),
  status: testimonialStatusEnum("status").notNull().default("pending"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"), // Admin user ID (Clerk ID)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

### Testimonial Submission Page

**Route**: `/testimonials/submit`

**Authentication**: Required (Clerk)

**Query Parameters**: 
- `mentor` (mentorId) - Required, pre-fills mentor name
- `sessionPack` (sessionPackId) - Optional, links testimonial to specific pack

**Form Fields**:
- Mentor name (pre-filled from query param, read-only)
- Testimonial text (textarea, required)
  - Min length: 50 characters
  - Max length: 1000 characters
  - Character counter displayed
- Submit button

**Validation**:
- User must be authenticated
- User must have completed pack with this mentor
- Prevent duplicate submissions (one testimonial per pack)
- Show error if user hasn't completed any sessions with mentor
- Validate text length (50-1000 chars)

**Success Flow**:
- Submit testimonial via `POST /api/testimonials`
- Redirect to mentor profile page with success message
- Show confirmation: "Thank you! Your testimonial is pending review."

**Error Handling**:
- Show validation errors inline
- Handle API errors gracefully
- Display user-friendly error messages

### Testimonial Submission Flow

**1. Student Submits Testimonial** (`POST /api/testimonials`)
- Authenticated user only (Clerk)
- Request body:
  ```typescript
  {
    mentorId: string,
    sessionPackId?: string, // Optional
    testimonialText: string // 50-1000 characters
  }
  ```
- Validation:
  - User has completed pack with this mentor
  - Check for duplicate submission (one per pack)
  - Validate text length
- Create testimonial record (status: `pending`)
- Send confirmation email to student
- Notify admin of pending testimonial (Discord/email)

**2. Admin Review** (Admin Dashboard)
- View pending testimonials list
- Display:
  - Mentor name
  - Student name (from users table)
  - Testimonial text
  - Submission date
  - Session pack info (if linked)
- Actions:
  - Approve (with optional text edit)
  - Reject (with optional feedback)

**3. Approval Workflow**
- Admin approves → Status: `approved`
- Set `reviewedAt` timestamp
- Set `reviewedBy` (admin user ID)
- If text was edited, update `testimonialText`
- Testimonial appears on:
  - Instructor profile page (public)
  - Instructor dashboard (mentor view)
  - Public homepage (featured testimonials carousel)
- Send notification to student: "Your testimonial has been published"
- Send notification to mentor: "You received a new testimonial"

**4. Rejection Workflow**
- Admin rejects → Status: `rejected`
- Set `reviewedAt` timestamp
- Set `reviewedBy` (admin user ID)
- Optional: Store rejection reason (could add field to schema)
- Optionally send feedback email to student explaining rejection
- Testimonial hidden from all public views

### Testimonial Display

**Instructor Profile Page:**
- Show approved testimonials in dedicated section
- Display:
  - Student name (from users table, full name)
  - Testimonial text
  - Submission date
- Order: Most recent first
- Limit: Show all approved testimonials (or paginate if many)

**Instructor Dashboard:**
- Show all testimonials (pending, approved, rejected)
- Filter by status
- Display same info as profile page
- Allow mentor to view but not edit/delete
- Show status badges (pending/approved/rejected)

**Public Homepage:**
- Featured testimonials carousel
- Rotate through approved testimonials
- Display:
  - Student name
  - Testimonial text (truncated if long)
  - Mentor name
  - Link to instructor profile
- Auto-rotate every 5-10 seconds
- Manual navigation arrows

### Testimonial API Endpoints

**`POST /api/testimonials`** - Submit testimonial (student, authenticated)
- Authentication: Required (Clerk)
- Request body:
  ```typescript
  {
    mentorId: string,
    sessionPackId?: string,
    testimonialText: string
  }
  ```
- Validates: User has completed pack with mentor
- Returns: Created testimonial record
- Status code: 201 Created

**`GET /api/testimonials/me`** - Get user's submitted testimonials
- Authentication: Required (Clerk)
- Returns: All testimonials submitted by authenticated user
- Includes status, submission date, mentor info

**`GET /api/testimonials/mentor/:mentorId`** - Get approved testimonials for mentor (public)
- Authentication: Not required
- Returns: Only approved testimonials for display
- Used by instructor profile page and homepage

**`GET /api/admin/testimonials/pending`** - Get pending testimonials (admin only)
- Authentication: Required (Clerk, admin role)
- Returns: All pending testimonials with mentor and student info
- Includes full details for review

**`PATCH /api/admin/testimonials/:id/approve`** - Approve testimonial (admin only)
- Authentication: Required (Clerk, admin role)
- Request body:
  ```typescript
  {
    testimonialText?: string // Optional text edit
  }
  ```
- Updates status to `approved`
- Sets `reviewedAt` and `reviewedBy`
- If text provided, updates `testimonialText`
- Sends notifications to student and mentor
- Returns: Updated testimonial record

**`PATCH /api/admin/testimonials/:id/reject`** - Reject testimonial (admin only)
- Authentication: Required (Clerk, admin role)
- Request body:
  ```typescript
  {
    rejectionReason?: string // Optional feedback
  }
  ```
- Updates status to `rejected`
- Sets `reviewedAt` and `reviewedBy`
- Optionally sends feedback email to student
- Returns: Updated testimonial record

---

## 7. Edge Cases & Concerns

### Payment Edge Cases

**1. Webhook Received Before User Returns**
- User completes payment but closes browser
- Webhook processes: pack + seat created
- User returns later → Show success page with pack details

**2. Duplicate Webhook Processing**
- Implement idempotency check:
  ```typescript
  const existingPayment = await getPaymentByProviderId(providerPaymentId);
  if (existingPayment) {
    return; // Already processed
  }
  ```

**3. Payment Succeeds but Webhook Fails**
- Stripe retries webhooks automatically
- Consider manual reconciliation endpoint for admin

**4. Concurrent Purchase Attempts**
- Two users try to buy last seat simultaneously
- Solution: Database transaction with row-level locking
- First transaction commits, second fails with "no seats available"

### Seat Management Edge Cases

**1. Multiple Packs with Same Mentor**
- User buys Pack 1 (4 sessions) → Gets 1 seat
- User buys Pack 2 (4 sessions) while Pack 1 has 2 remaining
- Result: Sessions stack (6 total remaining), still 1 seat
- Implementation: Check for existing active seat before creating new one

**2. Pack Expires with Scheduled Sessions**
- Pack expires but user has future sessions scheduled
- Solution: Allow scheduled sessions to complete, block new bookings
- Update pack status to `expired` but don't release seat until sessions complete

**3. Refund Scenarios**
- Full refund: Release seat immediately, mark pack as `refunded`
- Partial refund: Calculate by remaining sessions
  ```typescript
  refundAmount = (remainingSessions / totalSessions) * amountPaid
  ```
- Seat released on refund (regardless of grace period)

**4. Manual Seat Release**
- Admin/mentor can manually release seat
- Use case: Student inactive, mentor wants to accept new student
- Implementation: Admin endpoint to release seat + mark pack appropriately

### Onboarding Edge Cases

**1. User Completes Onboarding After Booking Attempt**
- User tries to book → Blocked (onboarding incomplete)
- User completes onboarding → Can now book
- UI should show clear message: "Complete onboarding to book sessions"

**2. Onboarding Email Bounces**
- Handle gracefully, don't block pack creation
- Log bounce for admin review

**3. User Never Completes Onboarding**
- Pack remains active but unusable
- Consider: Auto-refund after X days? Or manual intervention?

### Booking Edge Cases

**1. Booking While Pack Expiring Soon**
- Pack expires in 2 days, user books session in 3 days
- Solution: Block booking if `scheduledAt > expiresAt`

**2. Rescheduling After Pack Expires**
- User has scheduled session, pack expires before session date
- Solution: Allow reschedule to earlier date, or cancel and refund

**3. Cancellation Policy**
- 24-hour minimum notice for cancellation
- If canceled < 24h before: Mark as `no_show`, don't refund session
- If canceled >= 24h before: Increment `remainingSessions`, allow rebooking

### Testimonial Edge Cases

**1. User Submits Multiple Testimonials for Same Mentor**
- Solution: One testimonial per session pack
- If user has multiple packs, can submit one per pack
- Check for existing testimonial with same `sessionPackId`

**2. Testimonial Submitted Before Pack Completed**
- Solution: Only allow testimonial submission after pack is completed (all 4 sessions)
- Validate in API endpoint

**3. Admin Edits Testimonial Text**
- Store original text? Or just update?
- Recommendation: Just update (simpler, admin has final say)

**4. Testimonial Display Performance**
- If many testimonials, implement pagination
- Cache approved testimonials for homepage carousel

---

## 8. Database Schema Updates Needed

### Add to `users` table or create `user_onboarding` table:
```typescript
onboarding_completed_at: timestamp | null
onboarding_profile_complete: boolean
onboarding_calendar_connected: boolean
onboarding_preferences_set: boolean
onboarding_goals_set: boolean
```

### Update `seat_reservations` table:
- Remove `seatExpiresAt` field (seats don't expire)
- Keep `gracePeriodEndsAt` (for grace period after pack depletion)
- Add index on `(mentorId, status)` for capacity checks

### Add new `testimonials` table:
- See schema in Section 6 above
- Add indexes:
  - `(mentorId, status)` for fetching approved testimonials
  - `(studentId)` for fetching user's testimonials
  - `(status)` for admin pending reviews

### Add to `session_packs`:
- Consider `onboarding_required` flag (for future flexibility)

---

## 9. API Endpoints Required

### Payment & Checkout
- `POST /api/checkout/stripe` - Create Stripe checkout session
- `POST /api/checkout/paypal` - Create PayPal order
- `POST /api/webhooks/stripe` - Handle Stripe webhooks
- `POST /api/webhooks/paypal` - Handle PayPal webhooks

### Onboarding
- `GET /api/onboarding/status` - Get user onboarding status
- `POST /api/onboarding/complete-step` - Mark step as complete
- `GET /api/onboarding/checklist` - Get onboarding checklist

### Booking
- `POST /api/sessions/book` - Book a session
- `PATCH /api/sessions/:id/reschedule` - Reschedule session
- `PATCH /api/sessions/:id/cancel` - Cancel session
- `PATCH /api/sessions/:id/complete` - Mark session complete

### Seat Management
- `GET /api/seats/availability/:mentorId` - Check seat availability
- `POST /api/seats/release/:seatId` - Manual seat release (admin)

### Testimonials
- `POST /api/testimonials` - Submit testimonial (student)
- `GET /api/testimonials/me` - Get user's submitted testimonials
- `GET /api/testimonials/mentor/:mentorId` - Get approved testimonials for mentor (public)
- `GET /api/admin/testimonials/pending` - Get pending testimonials (admin)
- `PATCH /api/admin/testimonials/:id/approve` - Approve testimonial (admin)
- `PATCH /api/admin/testimonials/:id/reject` - Reject testimonial (admin)

---

## 10. Scheduled Jobs Required

1. **Grace Period Handler** (hourly)
   - Find seats in grace period where `gracePeriodEndsAt < now`
   - Release seats, send notifications

2. **Pack Expiration Checker** (daily)
   - Find active packs where `expiresAt < now`
   - Update status to `expired`
   - Block new bookings (but allow scheduled sessions)

3. **Onboarding Reminder** (daily)
   - Find users with incomplete onboarding 24h+ after purchase
   - Send reminder emails

---

## 11. Implementation Priority

1. **Phase 1: Payment & Seat Creation**
   - Checkout endpoints
   - Webhook handlers
   - Seat reservation creation
   - Capacity checks

2. **Phase 2: Onboarding System**
   - Onboarding tracking
   - Completion checks
   - Email reminders
   - Dashboard visibility

3. **Phase 3: Booking System**
   - Booking eligibility checks
   - Session creation
   - Calendar integration

4. **Phase 4: Session Completion & Testimonials**
   - Session completion emails (sessions 3 & 4)
   - Testimonial schema and submission page
   - Testimonial API endpoints
   - Admin review dashboard
   - Testimonial display (profile, dashboard, homepage)

5. **Phase 5: Grace Period & Renewal**
   - Grace period management
   - Renewal during grace
   - Scheduled jobs

---

## 12. Key Implementation Notes

### Email Templates Needed
1. Session 3 completion email (with renewal reminder + testimonial request)
2. Session 4 completion email (with renewal reminder + testimonial request)
3. Testimonial submission confirmation
4. Testimonial approval notification (to student)
5. Testimonial received notification (to mentor)
6. Testimonial rejection notification (optional, to student)

### Frontend Pages Needed
1. `/testimonials/submit` - Testimonial submission form
2. Admin dashboard testimonial review section
3. Instructor profile testimonials section
4. Homepage featured testimonials carousel

### Security Considerations
- All testimonial endpoints require authentication
- Admin endpoints require admin role check
- Validate user has completed pack before allowing testimonial submission
- Prevent duplicate submissions (one per pack)
- Sanitize testimonial text before storing/displaying

This workflow ensures data consistency, handles edge cases, and provides a smooth user experience while maintaining mentor capacity limits and onboarding requirements.


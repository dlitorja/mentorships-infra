# Multiple Mentorships Analysis

**Use Case**: A mentee can have multiple active mentorships with different instructors simultaneously.

**Frequency**: 95% of cases = 1 instructor, 5% = 2+ instructors

## ✅ Greptile Analysis Confirmation

**Query Date**: Current Session  
**Greptile Response**: ✅ **CONFIRMED** - Schema fully supports multiple active session packs with different mentors

**Key Findings from Greptile**:
- ✅ No unique constraints preventing multiple active packs per user
- ✅ Each pack is tied to a specific mentor (one-to-many relationship)
- ✅ Sessions reference both `sessionPackId` and maintain separate `mentorId` and `studentId` fields
- ✅ Independent pack management (status, remainingSessions, expiresAt per pack)
- ⚠️ Business logic note: "Multiple Packs: Extend current pack" applies to **same mentor**, not different mentors

---

## ✅ Schema Support Analysis

### Current Schema Status: **FULLY SUPPORTS Multiple Mentorships**

#### 1. `session_packs` Table
```typescript
- userId (mentee) - NOT unique
- mentorId - NOT unique
- NO composite unique constraint on (userId, mentorId)
```

**✅ Result**: A mentee CAN have multiple active packs with different mentors.

**Example**:
- Mentee A has Pack 1 with Mentor X (active)
- Mentee A has Pack 2 with Mentor Y (active)
- ✅ Both allowed simultaneously

---

#### 2. `seat_reservations` Table
```typescript
- userId (mentee) - NOT unique
- mentorId - NOT unique
- sessionPackId - NOT unique
- NO unique constraint on (userId, mentorId)
```

**✅ Result**: A mentee CAN have multiple seat reservations (one per mentor).

**Example**:
- Mentee A has Seat 1 with Mentor X (active)
- Mentee A has Seat 2 with Mentor Y (active)
- ✅ Both allowed - each mentor tracks their own seats

**Critical Note**: The plan says "Each active student reserves **one mentor seat**" - this is **per mentor**, not globally. Each mentor has their own seat pool.

---

#### 3. `sessions` Table
```typescript
- studentId (mentee) - NOT unique
- mentorId - NOT unique
- sessionPackId - NOT unique
- NO constraints preventing multiple sessions with different mentors
```

**✅ Result**: A mentee CAN have sessions scheduled with multiple mentors.

**Example**:
- Mentee A has Session 1 with Mentor X (scheduled)
- Mentee A has Session 2 with Mentor Y (scheduled)
- ✅ Both allowed simultaneously

---

#### 4. `orders` Table
```typescript
- userId (mentee) - NOT unique
- NO constraints preventing multiple orders
```

**✅ Result**: A mentee CAN place multiple orders for different mentors.

---

## 🔍 Potential Issues & Considerations

### 1. Seat Availability Logic (CRITICAL)

**Current Plan Language**: "Each active student reserves **one mentor seat**"

**Clarification Needed**: This should be **"one seat per mentor"**, not globally.

**Implementation Requirements**:
- ✅ Seat availability checks must be **per mentor**
- ✅ When checking if a mentor has available seats, count only seats for THAT mentor
- ✅ A mentee can reserve a seat with Mentor X even if they already have a seat with Mentor Y

**Example Query**:
```sql
-- Check if Mentor X has available seats
SELECT COUNT(*) FROM seat_reservations 
WHERE mentor_id = 'mentor-x-id' 
  AND status = 'active'
  AND seat_expires_at > NOW();

-- Compare to mentor's max_active_students
-- This is INDEPENDENT of mentee's other mentorships
```

---

### 2. Session Pack Queries

**Requirement**: All queries must support filtering by mentor.

**API Endpoints Needed**:
- `GET /api/session-packs/me` - Get all packs (all mentors)
- `GET /api/session-packs/me?mentorId=xxx` - Get packs for specific mentor
- `GET /api/session-packs/me/active` - Get all active packs (all mentors)

**Dashboard Display**:
- Show all mentorships grouped by mentor
- Each mentorship shows:
  - Mentor name
  - Remaining sessions
  - Expiration date
  - Next scheduled session

---

### 3. Booking Flow

**Requirement**: Must allow selecting which mentor to book with.

**Booking API**:
```typescript
POST /api/sessions/book
{
  mentorId: "mentor-x-id",  // Required - specifies which mentor
  scheduledAt: "2024-01-15T10:00:00Z"
}

// Logic:
// 1. Get mentee's active packs for THIS mentor
// 2. Check if any pack has remaining_sessions > 0
// 3. Check if seat is active for THIS mentor
// 4. Create session with selected pack
```

**UI Requirements**:
- Show all active mentorships
- Allow selecting which mentor to book with
- Show remaining sessions per mentor
- Calendar view should show all sessions (all mentors) or filter by mentor

---

### 4. Multiple Packs with Same Mentor

**Use Case**: What if a mentee buys 2 packs from the same mentor?

**Current Schema**: ✅ Supports this - no unique constraint on (userId, mentorId)

**Business Logic Decision**: ✅ **CONFIRMED** - From `KEY_DECISIONS.md`:
> "Multiple Packs: Extend current pack (add sessions, extend expiration)"

**Decision**: **Extend existing pack** (Option A) - This is the confirmed approach.

**Implementation**:
```typescript
// When purchasing new pack with same mentor:
// 1. Check if mentee has active pack with this mentor
// 2. If yes: Extend existing pack
//    - Add sessions to remaining_sessions
//    - Extend expires_at if new expiration is later
// 3. If no: Create new pack + seat reservation
```

---

### 5. Seat Reservation Logic

**Current Schema**: ✅ Supports multiple seats per mentee (one per mentor)

**Implementation Requirements**:
- When creating seat reservation, check mentor's seat availability (not global)
- When releasing seat, only release seat for that specific mentor
- Grace period is per mentorship (per mentor), not global

**Example**:
```typescript
// Mentee has 2 mentorships:
// - Mentor X: 1 session remaining, grace period ends in 2 days
// - Mentor Y: 3 sessions remaining, active

// Grace period logic applies per mentor:
// - Mentor X seat will be released in 2 days if not renewed
// - Mentor Y seat remains active
```

---

## 📋 Implementation Checklist

### Database Schema
- [x] Schema supports multiple mentorships ✅
- [x] No constraints preventing multiple packs per mentee ✅
- [x] Seat reservations are per mentor ✅

### API Endpoints
- [ ] `GET /api/session-packs/me` - Support filtering by mentorId
- [ ] `GET /api/session-packs/me/active` - Return all active packs (all mentors)
- [ ] `POST /api/sessions/book` - Require mentorId parameter
- [ ] `GET /api/sessions/me` - Support filtering by mentorId
- [ ] `GET /api/seats/availability/:mentorId` - Check per mentor (already correct)

### Business Logic
- [ ] Seat availability checks are per mentor (not global)
- [ ] **Multiple packs with same mentor → extend existing pack** (CONFIRMED in KEY_DECISIONS.md)
- [ ] Multiple packs with different mentors → separate packs
- [ ] Grace period logic is per mentorship (per mentor)
- [ ] Renewal reminders are per mentorship (per mentor)

### UI/UX
- [ ] Dashboard shows all mentorships grouped by mentor
- [ ] Booking flow allows selecting which mentor
- [ ] Calendar view shows all sessions or filters by mentor
- [ ] Session pack cards show mentor name
- [ ] Clear indication when mentee has multiple mentorships

### Testing Scenarios
- [ ] Test: Mentee with 2 different mentors (both active)
- [ ] Test: Mentee with 2 packs from same mentor (should extend)
- [ ] Test: Seat availability per mentor (independent)
- [ ] Test: Booking session with specific mentor
- [ ] Test: Grace period per mentorship (independent)
- [ ] Test: Renewal reminders per mentorship

---

## 🎯 Key Implementation Principles

1. **Per-Mentor Isolation**: All seat/pack logic is per mentor, not global
2. **Multiple Mentorships**: Fully supported - no restrictions
3. **Same Mentor Multiple Packs**: Extend existing pack (don't create duplicate)
4. **UI Clarity**: Always show which mentor each pack/session belongs to
5. **Independent Lifecycles**: Each mentorship has its own expiration, grace period, etc.

---

## 📝 Documentation Updates Needed

1. Update `mentorship-platform-plan.md`:
   - Clarify "one mentor seat" = "one seat per mentor"
   - Add section on multiple mentorships support

2. Update `PROJECT_STATUS.md`:
   - Note multiple mentorships are supported
   - Add to implementation checklist

3. Add to API documentation:
   - All endpoints support mentorId filtering
   - Booking requires mentorId

---

## ✅ Conclusion

**Schema Status**: ✅ **FULLY SUPPORTS** multiple mentorships (Confirmed by Greptile)

**Greptile Recommendations**:
1. **Clear UI/UX**: When booking sessions, clearly show which pack the session will be deducted from
2. **Pack Selection**: Allow users to choose which pack to use when booking with a mentor they have multiple packs with
3. **Dashboard Clarity**: Show all active packs clearly with their respective mentors and remaining sessions
4. **Business Rules**: Consider implementing optional limits (e.g., max 3 active packs) if needed for business reasons

**Action Items**:
1. ✅ Schema is correct - no changes needed (Greptile confirmed)
2. ⚠️ Ensure business logic is per-mentor (not global)
3. ⚠️ Update documentation to clarify per-mentor semantics
4. ⚠️ Implement mentorId filtering in all queries
5. ⚠️ Handle "extend pack" logic for same mentor (different mentors = separate packs)

**No Schema Changes Required** - Current design already supports the use case! 🎉

**Greptile Sources**:
- `packages/db/src/schema/sessionPacks.ts`
- `packages/db/src/schema/users.ts`
- `packages/db/src/schema/sessions.ts`
- `KEY_DECISIONS.md`
- `TECH_DECISIONS.md`


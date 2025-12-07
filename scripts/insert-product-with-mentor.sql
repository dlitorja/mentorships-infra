-- Complete script: Create mentor (if needed) and product
-- Run this in Supabase Dashboard → SQL Editor

-- Step 1: If you need to create a mentor first
-- Replace 'CLERK_USER_ID_HERE' with Ash Kirk's Clerk user ID
INSERT INTO mentors (
  user_id,
  max_active_students,
  bio
) VALUES (
  'CLERK_USER_ID_HERE',  -- ⚠️ REPLACE with Ash Kirk's Clerk user ID
  10,
  'Mentorship description for Ash Kirk'
)
ON CONFLICT (user_id) DO NOTHING
RETURNING id, user_id;

-- Step 2: Get the mentor ID from the result above, then use it below
-- Or if mentor already exists, find it:
-- SELECT id FROM mentors WHERE user_id = 'CLERK_USER_ID_HERE';

-- Step 3: Insert the product (use the mentor ID from step 1 or 2)
INSERT INTO mentorship_products (
  mentor_id,
  title,
  price,
  stripe_price_id,
  sessions_per_pack,
  validity_days,
  active
) VALUES (
  'MENTOR_ID_FROM_STEP_1',  -- ⚠️ REPLACE with mentor UUID from above
  'Ash Kirk 1-on-1 Mentorship (4 sessions)',
  '375.00',
  'price_1SbNPUA4l1a5LDm782TSgPx6',
  4,
  30,
  true
)
RETURNING *;


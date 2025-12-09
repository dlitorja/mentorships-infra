-- SQL script to insert the mentorship product
-- Run this in Supabase Dashboard → SQL Editor

-- First, check if you have a mentor record:
-- SELECT id, user_id FROM mentors LIMIT 10;

-- Replace 'YOUR_MENTOR_ID_HERE' with the actual mentor UUID from the query above
INSERT INTO mentorship_products (
  mentor_id,
  title,
  price,
  stripe_price_id,
  sessions_per_pack,
  validity_days,
  active
) VALUES (
  'YOUR_MENTOR_ID_HERE',  -- ⚠️ REPLACE THIS with actual mentor UUID
  'Ash Kirk 1-on-1 Mentorship (4 sessions)',
  '375.00',
  'price_1SbNPUA4l1a5LDm782TSgPx6',
  4,
  30,
  true
)
RETURNING *;


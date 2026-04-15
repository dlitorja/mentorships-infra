-- Migration: Import instructors from apps/marketing/lib/instructors.ts
-- Run this SQL manually after the tables are created

-- First, insert all instructors (excluding hidden ones like test-instructor-waitlist)
-- This script needs to be run manually or via a script that parses the JSON

-- Example insert (you'll need to fill in the actual data from apps/marketing/lib/instructors.ts):
-- INSERT INTO instructors (name, slug, tagline, bio, specialties, background, profile_image_url, portfolio_images, socials, is_active)
-- VALUES (
--   'Jordan Jardine',
--   'jordan-jardine',
--   'Toronto-based Freelance Artist Specializing in Digital Painting, Illustration and Concept Art',
--   'Jordan Jardine is a Toronto-based freelance artist...',
--   ARRAY['Digital Painting', 'Illustration', 'Concept Art', 'Character Development', 'Environment Development', '2D Asset Creation'],
--   ARRAY['Freelance', 'Indie'],
--   '/instructors/jordan-jardine/work-2.jpg',
--   ARRAY['/instructors/jordan-jardine/work-1.jpg', '/instructors/jordan-jardine/work-2.jpg', '/instructors/jordan-jardine/work-3.jpg'],
--   '{"website": "https://www.jordanjardine.com"}'::jsonb,
--   true
-- );

-- To properly import all instructors, run this script from the command line:
-- npx tsx scripts/migrate-instructors.ts
-- (Requires DATABASE_URL to be set)

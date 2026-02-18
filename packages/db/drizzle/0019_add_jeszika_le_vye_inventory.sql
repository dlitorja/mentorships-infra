-- Add Jeszika Le Vye to instructor inventory
-- This migration adds the new instructor to the inventory table
-- Run this in Supabase SQL Editor if the record doesn't exist

-- Insert Jeszika Le Vye inventory record (0 inventory initially)
INSERT INTO instructor_inventory (instructor_slug, one_on_one_inventory, group_inventory)
VALUES ('jeszika-le-vye', 0, 0)
ON CONFLICT (instructor_slug) DO NOTHING;

-- Add new fields to mentorship_products table
-- description, image_url, currency, stripe_product_id, mentorship_type

-- Add description column
ALTER TABLE mentorship_products ADD COLUMN IF NOT EXISTS description TEXT;

-- Add image_url column
ALTER TABLE mentorship_products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add currency column with default 'usd'
ALTER TABLE mentorship_products ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'usd';

-- Add stripe_product_id column
ALTER TABLE mentorship_products ADD COLUMN IF NOT EXISTS stripe_product_id TEXT;

-- Add mentorship_type column with default 'one-on-one'
ALTER TABLE mentorship_products ADD COLUMN IF NOT EXISTS mentorship_type TEXT NOT NULL DEFAULT 'one-on-one';

-- Create index for faster queries by mentorship_type
CREATE INDEX IF NOT EXISTS idx_mentorship_products_mentorship_type ON mentorship_products(mentorship_type);

-- Create index for faster queries by mentor_id
CREATE INDEX IF NOT EXISTS idx_mentorship_products_mentor_id ON mentorship_products(mentor_id);

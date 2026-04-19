-- Add mentorship_type column to session_packs for refund lookup
ALTER TABLE session_packs ADD COLUMN mentorship_type text NOT NULL DEFAULT 'one-on-one';
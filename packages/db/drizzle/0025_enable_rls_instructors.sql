-- Enable RLS on tables flagged by Supabase Security Advisor
-- Migration: 0025_enable_rls_instructors

-- Enable RLS on instructors
ALTER TABLE instructors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to instructors" ON instructors
  FOR SELECT USING (true);

-- Enable RLS on instructor_testimonials
ALTER TABLE instructor_testimonials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to instructor_testimonials" ON instructor_testimonials
  FOR SELECT USING (true);

-- Enable RLS on mentee_results
ALTER TABLE mentee_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to mentee_results" ON mentee_results
  FOR SELECT USING (true);

-- Enable RLS on mentee_invitations
-- Note: Requires authenticated users due to PII (email) and sensitive tokens
ALTER TABLE mentee_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read mentee_invitations" ON mentee_invitations
  FOR SELECT USING (auth.role() = 'authenticated');

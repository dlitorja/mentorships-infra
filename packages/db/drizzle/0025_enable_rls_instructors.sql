-- Enable RLS on tables flagged by Supabase Security Advisor
-- Migration: 0025_enable_rls_instructors

-- Enable RLS on instructors
ALTER TABLE instructors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to instructors" ON instructors
  FOR SELECT USING (true);
CREATE POLICY "Service role can manage instructors" ON instructors
  FOR ALL USING (auth.role() = 'service_role');

-- Enable RLS on instructor_testimonials
ALTER TABLE instructor_testimonials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to instructor_testimonials" ON instructor_testimonials
  FOR SELECT USING (true);
CREATE POLICY "Service role can manage instructor_testimonials" ON instructor_testimonials
  FOR ALL USING (auth.role() = 'service_role');

-- Enable RLS on mentee_results
ALTER TABLE mentee_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to mentee_results" ON mentee_results
  FOR SELECT USING (true);
CREATE POLICY "Service role can manage mentee_results" ON mentee_results
  FOR ALL USING (auth.role() = 'service_role');

-- Enable RLS on mentee_invitations
ALTER TABLE mentee_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to mentee_invitations" ON mentee_invitations
  FOR SELECT USING (true);
CREATE POLICY "Service role can manage mentee_invitations" ON mentee_invitations
  FOR ALL USING (auth.role() = 'service_role');

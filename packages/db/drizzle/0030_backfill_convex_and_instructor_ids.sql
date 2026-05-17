-- Deterministic backfills using existing keys
-- Goal: populate analytics/helper columns without guessing

begin;

-- 1) sessions.instructor_id (uuid) <- session_packs.instructor_id (text uuid)
update public.sessions s
set instructor_id = sp.instructor_id::uuid
from public.session_packs sp
where s.session_pack_id = sp.id
  and s.instructor_id is null
  and sp.instructor_id is not null;

-- 2) student_onboarding_submissions.instructor_id (uuid) <- session_packs.instructor_id (text uuid)
update public.student_onboarding_submissions sos
set instructor_id = sp.instructor_id::uuid
from public.session_packs sp
where sos.session_pack_id = sp.id
  and sos.instructor_id is null
  and sp.instructor_id is not null;

-- 3) seat_reservations.instructor_id (text) <- instructor_integrations.id via instructors.user_id
-- Chain: sr.session_pack_id -> sp.id; sp.instructor_id::uuid -> instructors.id; instructors.user_id -> instructor_integrations.user_id
update public.seat_reservations sr
set instructor_id = ii.id
from public.session_packs sp
join public.instructors i on i.id = sp.instructor_id::uuid
join public.instructor_integrations ii on ii.user_id = i.user_id
where sr.session_pack_id = sp.id
  and sr.instructor_id is null;

commit;

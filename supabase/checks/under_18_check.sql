-- DIRA LEARN: READ-ONLY check for people under 18 already in the database. Safe on production: it only reads.
-- Paste into Supabase > SQL Editor and press Run. It shows participant numbers and ages only (no names).
select 'participant' as kind, p.participant_no as reference, date_part('year', age(current_date, p.date_of_birth))::int as age_today
from participants p where p.date_of_birth > (current_date - interval '18 years')::date
union all
select 'application', a.id::text, date_part('year', age(current_date, (a.form_data ->> 'dateOfBirth')::date))::int
from applications a
where a.status not in ('draft', 'rejected')
  and (a.form_data ->> 'dateOfBirth') ~ '^\d{4}-\d{2}-\d{2}$'
  and (a.form_data ->> 'dateOfBirth')::date > (current_date - interval '18 years')::date
order by 1, 2;

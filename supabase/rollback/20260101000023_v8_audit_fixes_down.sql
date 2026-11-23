-- Rollback for migration 23 (V8 audit fixes): puts the five functions back exactly as migrations 18-22 left them.
-- Run in the Supabase SQL editor only if migration 23 causes a problem. No data is changed either way.
-- After running it, also delete the row for version 20260101000023 from supabase_migrations.schema_migrations
-- if you want `supabase db push` to apply migration 23 again later.
do $$
declare r record; def text; newdef text;
begin
  for r in
    select * from (values
      ('learner_access_state(uuid,uuid)',
       'if not coalesce(is_trusted_session() or is_staff() or p_participant = my_participant_id() or trainer_can_see_participant(p_participant), false) then return null; end if;',
       'if not (is_staff() or p_participant = my_participant_id() or trainer_can_see_participant(p_participant)) then return null; end if;'),
      ('transition_application(uuid,application_status,text)',
       E'\n  perform set_config(''dira.application_transition'', ''off'', true);', ''),
      ('decide_application(uuid,text,text)',
       E'perform set_config(''dira.application_transition'', ''off'', true);\n  perform set_config(''dira.application_decision'', ''off'', true);\n  ', ''),
      ('review_curriculum_topic(uuid,text,text)',
       E'perform set_config(''dira.topic_review'', ''off'', true);\n  ', ''),
      ('guard_connect_message()',
       E'if not is_trusted_session() and new.sender_id is distinct from auth.uid() then\n    raise exception ''You can only send messages as yourself'';\n  end if;\n  ', '')
    ) as t(sig, old_txt, new_txt)
  loop
    def := pg_get_functiondef(('public.' || r.sig)::regprocedure);
    newdef := replace(def, r.old_txt, r.new_txt);
    if newdef = def then raise exception 'Rollback 23: text not found in function %, nothing was changed', r.sig; end if;
    execute newdef;
  end loop;
end $$;

-- DIRA LEARN: fixes found by the V8 handover audit (19 Nov 2026), the first time migrations 1-22 were executed on PostgreSQL.
-- STATUS: executed and tested locally on PostgreSQL 16 with a Supabase stand-in (see docs/HANDOVER_AUDIT_V8.md). Not yet on Supabase.
-- No data is changed. Rollback: supabase/rollback/20260101000023_v8_audit_fixes_down.sql
--
-- 1. learner_access_state(): NULL-logic slip. For a signed-in user who is not a learner (for example an applicant or a mentor),
--    "p_participant = my_participant_id()" is NULL, so "not (... or NULL or ...)" is NULL and the guard did not stop them:
--    they could look up any learner's access status. Now only staff, the learner, the learner's trainer, or a trusted server
--    session (reminder jobs) get an answer; everyone else gets NULL.
-- 2. Workflow flags no longer outlive the function that sets them. transition_application(), decide_application() and
--    review_curriculum_topic() switched a transaction-wide flag on and never off, so a later direct UPDATE in the SAME transaction
--    could skip the application-status and topic guards. Through the app every request is its own transaction, so this was not
--    reachable from the screens, but it is closed now (defence in depth).
-- 3. DIRA Connect: sending a message "as someone else" is refused. Before, the database silently rewrote the sender to the
--    signed-in person and posted the message; nobody could impersonate anyone, but the message was still posted. Now it is rejected.

do $$
declare r record; def text; newdef text;
begin
  for r in
    select * from (values
      ('learner_access_state(uuid,uuid)',
       'if not (is_staff() or p_participant = my_participant_id() or trainer_can_see_participant(p_participant)) then return null; end if;',
       'if not coalesce(is_trusted_session() or is_staff() or p_participant = my_participant_id() or trainer_can_see_participant(p_participant), false) then return null; end if;'),
      ('transition_application(uuid,application_status,text)',
       'update applications set status = p_to where id = p_app;',
       'update applications set status = p_to where id = p_app;' || E'\n  ' || 'perform set_config(''dira.application_transition'', ''off'', true);'),
      ('decide_application(uuid,text,text)',
       'return jsonb_build_object(''status'', new_status, ''participant_id'', pid);',
       'perform set_config(''dira.application_transition'', ''off'', true);' || E'\n  ' ||
       'perform set_config(''dira.application_decision'', ''off'', true);' || E'\n  ' ||
       'return jsonb_build_object(''status'', new_status, ''participant_id'', pid);'),
      ('review_curriculum_topic(uuid,text,text)',
       'return jsonb_build_object(''status'', new_state);',
       'perform set_config(''dira.topic_review'', ''off'', true);' || E'\n  ' || 'return jsonb_build_object(''status'', new_state);'),
      ('guard_connect_message()',
       'new.sender_id := coalesce(auth.uid(), new.sender_id);',
       'if not is_trusted_session() and new.sender_id is distinct from auth.uid() then' || E'\n    ' ||
       'raise exception ''You can only send messages as yourself'';' || E'\n  ' || 'end if;' || E'\n  ' ||
       'new.sender_id := coalesce(auth.uid(), new.sender_id);')
    ) as t(sig, old_txt, new_txt)
  loop
    def := pg_get_functiondef(('public.' || r.sig)::regprocedure);
    if (length(def) - length(replace(def, r.old_txt, ''))) / length(r.old_txt) <> 1 then
      raise exception 'Migration 23: expected text not found exactly once in function %, nothing was changed', r.sig;
    end if;
    newdef := replace(def, r.old_txt, r.new_txt);
    execute newdef;
  end loop;
end $$;

set session_replication_role = replica;  -- disposable audit DB only: bypass triggers to plant data
-- users: L1=..10 L2=..11 L3=..12 L4=..13 (participants d1a11111-...-0000000000NN), TA=..06 (cohort A), TB=..07 (cohort B)
insert into session_schedules(id,cohort_id,curriculum_session_id,trainer_id,starts_at,ends_at)
 select 'aa000000-0000-0000-0000-00000000000a'::uuid,'d1a22222-0000-0000-0000-00000000000a'::uuid,(select id from curriculum_sessions limit 1),'d1a00000-0000-0000-0000-000000000006'::uuid,now(),now()+interval '2h'
 union all select 'aa000000-0000-0000-0000-00000000000b'::uuid,'d1a22222-0000-0000-0000-00000000000b'::uuid,(select id from curriculum_sessions limit 1),'d1a00000-0000-0000-0000-000000000007'::uuid,now(),now()+interval '2h';
insert into attendance(schedule_id,participant_id,status) values
 ('aa000000-0000-0000-0000-00000000000a','d1a11111-0000-0000-0000-000000000010','present'),
 ('aa000000-0000-0000-0000-00000000000a','d1a11111-0000-0000-0000-000000000011','absent'),
 ('aa000000-0000-0000-0000-00000000000b','d1a11111-0000-0000-0000-000000000013','present');
insert into assignments(id,cohort_id,title,max_score) values ('ab000000-0000-0000-0000-00000000000a','d1a22222-0000-0000-0000-00000000000a','A task',100),('ab000000-0000-0000-0000-00000000000b','d1a22222-0000-0000-0000-00000000000b','B task',100);
insert into submissions(assignment_id,participant_id,body,score,feedback) values
 ('ab000000-0000-0000-0000-00000000000a','d1a11111-0000-0000-0000-000000000010','L1 work',70,'L1 fb'),
 ('ab000000-0000-0000-0000-00000000000a','d1a11111-0000-0000-0000-000000000011','L2 work',40,'L2 fb'),
 ('ab000000-0000-0000-0000-00000000000b','d1a11111-0000-0000-0000-000000000013','L4 work',90,'L4 fb');
insert into connect_conversations(id,kind,learner_id,facilitator_id) values
 ('ac000000-0000-0000-0000-000000000001','direct','d1a11111-0000-0000-0000-000000000010','d1a00000-0000-0000-0000-000000000006'),
 ('ac000000-0000-0000-0000-000000000002','direct','d1a11111-0000-0000-0000-000000000013','d1a00000-0000-0000-0000-000000000007');
insert into connect_conversations(id,kind,learner_id) values ('ac000000-0000-0000-0000-000000000003','safeguarding','d1a11111-0000-0000-0000-000000000011');
insert into connect_messages(conversation_id,sender_id,body) values
 ('ac000000-0000-0000-0000-000000000001','d1a00000-0000-0000-0000-000000000010','L1 private to TA'),
 ('ac000000-0000-0000-0000-000000000002','d1a00000-0000-0000-0000-000000000013','L4 private to TB'),
 ('ac000000-0000-0000-0000-000000000003','d1a00000-0000-0000-0000-000000000011','L2 safeguarding message'),
 ((select id from connect_conversations where kind='cohort' and cohort_id='d1a22222-0000-0000-0000-00000000000a'),'d1a00000-0000-0000-0000-000000000010','cohort A chat'),
 ((select id from connect_conversations where kind='cohort' and cohort_id='d1a22222-0000-0000-0000-00000000000b'),'d1a00000-0000-0000-0000-000000000013','cohort B chat');
insert into safeguarding_records(participant_id,summary,severity) values ('d1a11111-0000-0000-0000-000000000011','CONFIDENTIAL about L2','high');
insert into learner_feedback(participant_id,cohort_id,author_id,body,shared_with_learner) values
 ('d1a11111-0000-0000-0000-000000000010','d1a22222-0000-0000-0000-00000000000a','d1a00000-0000-0000-0000-000000000006','private note on L1',false),
 ('d1a11111-0000-0000-0000-000000000010','d1a22222-0000-0000-0000-00000000000a','d1a00000-0000-0000-0000-000000000006','shared note on L1',true);
insert into certificates(participant_id,cohort_id,certificate_no) values ('d1a11111-0000-0000-0000-000000000010','d1a22222-0000-0000-0000-00000000000a','DIRA-TEST-0001');
insert into notifications(user_id,kind,title) values ('d1a00000-0000-0000-0000-000000000010','info','for L1'),('d1a00000-0000-0000-0000-000000000013','info','for L4');
set session_replication_role = origin;

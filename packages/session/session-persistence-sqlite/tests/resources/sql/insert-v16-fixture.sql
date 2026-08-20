INSERT INTO persistence_state (singleton, store_id)
VALUES (1, '00000000-0000-4000-8000-000000000016');
INSERT INTO sessions
  (id, version, created_at, cwd, parent_session, seed_length, origin,
   delegation_depth, agent_preset, agent_runtime, incarnation, revision)
VALUES
  ('legacy-16', 0, 16, '/legacy', NULL, NULL, NULL,
   NULL, 'standard', 'codex', '00000000-0000-4000-8000-000000000116', 2);
INSERT INTO events
  (session_id, seq, type, time, data, source_event_seqs, surface_op, ignorable)
VALUES
  ('legacy-16', 0, 'assistant/message', 16,
   '{"turn":1,"step":1,"message":{"role":"assistant","content":[]}}',
   '[7,3]', '"append"', NULL);

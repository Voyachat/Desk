INSERT INTO persistence_state (singleton, store_id)
VALUES (1, '00000000-0000-4000-8000-000000000017');
INSERT INTO sessions
  (id, version, created_at, cwd, parent_session, seed_length, origin,
   delegation_depth, agent_preset, incarnation, revision)
VALUES
  ('legacy-17', 0, 17, '/legacy', NULL, NULL, NULL,
   NULL, 'standard', '00000000-0000-4000-8000-000000000117', 1);
INSERT INTO events
  (session_id, seq, type, time, data, source_event_seqs, surface_op, ignorable)
VALUES
  ('legacy-17', 0, 'turn/start', 17, '{"turn":1}', NULL, NULL, NULL);

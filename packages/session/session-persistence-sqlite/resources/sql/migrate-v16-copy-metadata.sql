INSERT INTO persistence_state (singleton, store_id)
SELECT singleton, store_id FROM persistence_state_v16;

INSERT INTO sessions
  (id, version, created_at, cwd, parent_session, seed_length, origin,
   delegation_depth, agent_preset, incarnation, revision, agent_runtime)
SELECT id, version, created_at, cwd, parent_session, seed_length, origin,
       delegation_depth, agent_preset, incarnation, revision, agent_runtime
FROM sessions_v16;

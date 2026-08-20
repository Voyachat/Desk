SELECT id, version, created_at, cwd, parent_session, seed_length, origin,
       delegation_depth, agent_preset, incarnation, revision, agent_runtime
FROM sessions
WHERE id = ?;

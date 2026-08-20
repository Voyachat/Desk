SELECT session_id, seq, type, time, data, source_event_seqs, surface_op, ignorable
FROM events_v16
ORDER BY session_id, seq;

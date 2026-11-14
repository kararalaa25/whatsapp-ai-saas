-- READ ONLY; operator-only aggregate monitoring after approved installation.
-- No customer identifiers, messages, tokens, invite hashes or keys.
BEGIN TRANSACTION READ ONLY;
SELECT state,reason,count(*) AS jobs,min(created_at) AS oldest_created_at,
 max(attempts) AS highest_attempts FROM workspace_private.cloud_jobs
 WHERE state<>'done' GROUP BY state,reason ORDER BY oldest_created_at;
SELECT count(*) FILTER(WHERE unresolved>=500) AS workspaces_warning,
 count(*) FILTER(WHERE unresolved>=800) AS workspaces_critical,
 count(*) FILTER(WHERE unresolved>=1000) AS workspaces_saturated
 FROM (SELECT workspace_id,count(*) AS unresolved FROM workspace_private.cloud_jobs
 WHERE state<>'done' GROUP BY workspace_id) q;
SELECT status,count(*) AS attempts,min(created_at) AS oldest_attempt
 FROM workspace_private.cloud_attempts WHERE status IN ('dispatching','unknown','rejected','failed')
 GROUP BY status;
SELECT count(*) FILTER(WHERE expires_at<=now()) AS expired_credentials,
 count(*) FILTER(WHERE expires_at>now() AND expires_at<now()+interval '3 days') AS expiring_soon
 FROM workspace_private.cloud_credentials;
ROLLBACK;

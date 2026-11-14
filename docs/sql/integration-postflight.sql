-- READ ONLY. Only AFTER the complete seven-file chain has been verified.
-- Also run each phase's postflight: these counts do not prove RLS/JWT behavior.
BEGIN READ ONLY;
SELECT count(*) AS missing_subscription FROM public.workspaces w
 LEFT JOIN public.workspace_subscriptions s ON s.workspace_id=w.id WHERE s.workspace_id IS NULL;
SELECT count(*) AS missing_automation_settings FROM public.workspaces w
 LEFT JOIN public.whatsapp_automation_settings s ON s.workspace_id=w.id WHERE s.workspace_id IS NULL;
SELECT count(*) AS missing_inbox_state FROM public.ai_conversations c
 LEFT JOIN public.whatsapp_inbox_state s ON s.workspace_id=c.workspace_id AND s.conversation_id=c.id
 WHERE c.channel='whatsapp_test' AND s.conversation_id IS NULL;
SELECT status,plan_id,count(*) FROM public.workspace_subscriptions GROUP BY status,plan_id;
SELECT mode,count(*) FROM public.whatsapp_automation_settings GROUP BY mode;
SELECT count(*) AS invoice_count FROM workspace_private.billing_invoices;
SELECT count(*) AS event_count FROM workspace_private.billing_events;
SELECT status,reason,count(*) FROM workspace_private.whatsapp_intake GROUP BY status,reason;
SELECT count(*) AS tenants_above_queue_bound FROM
 (SELECT workspace_id FROM workspace_private.whatsapp_intake WHERE status<>'processed'
  GROUP BY workspace_id HAVING count(*)>1000) q;
SELECT count(*) AS processed_without_projection FROM workspace_private.whatsapp_intake q
 WHERE q.status='processed' AND NOT EXISTS
 (SELECT 1 FROM public.ai_messages m WHERE m.workspace_id=q.workspace_id AND m.inbound_message_id=q.inbound_id);
-- Require all ten Phase 8 triggers enabled (O) and inspect their definitions in
-- integration-inventory.sql. In particular require BOTH automation guards.
SELECT expected.name,t.tgenabled,t.tgrelid::regclass AS relation
 FROM unnest(ARRAY['subscription_audit','initialize_subscription','subscription_products',
 'subscription_faqs','subscription_numbers','subscription_members','subscription_conversations',
 'subscription_drafts','subscription_automation_settings','subscription_automation_runs']) expected(name)
 LEFT JOIN pg_trigger t ON t.tgname=expected.name AND NOT t.tgisinternal
 ORDER BY 1;
ROLLBACK;

-- UNAPPLIED Phase 8. Requires migrations 000000 through 040000; Phase 7B guards are conditional.
-- No billing provider access or client subscription mutation is installed.
BEGIN;
CREATE TABLE public.subscription_plans (
 id text PRIMARY KEY CHECK (id IN ('trial','starter','pro','business')),
 name_en text NOT NULL, name_ar text NOT NULL,
 trial_days integer NOT NULL CHECK (trial_days BETWEEN 0 AND 90),
 grace_days integer NOT NULL CHECK (grace_days BETWEEN 0 AND 30),
 prices jsonb NOT NULL CHECK (jsonb_typeof(prices) = 'object'),
 limits jsonb NOT NULL CHECK (jsonb_typeof(limits) = 'object'),
 features jsonb NOT NULL CHECK (jsonb_typeof(features) = 'object'),
 provisional boolean NOT NULL DEFAULT true CHECK (provisional),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
-- Unconfigured provisional prices: NULL is not a zero-price paid offer.
-- Quotas are provisional technical defaults, bounded by existing abuse caps.
INSERT INTO public.subscription_plans VALUES
 ('trial','Free Trial','تجربة مجانية',14,0,'{"IQD":{"monthly":null,"annual":null},"USD":{"monthly":null,"annual":null}}','{"ai_generations":50,"whatsapp_conversations":50,"numbers":1,"products":25,"members":1,"faqs":25}','{"manual_inbox":true,"ai_drafts":true,"automation":true}',true,1),
 ('starter','Starter','البداية',0,3,'{"IQD":{"monthly":null,"annual":null},"USD":{"monthly":null,"annual":null}}','{"ai_generations":300,"whatsapp_conversations":300,"numbers":1,"products":100,"members":2,"faqs":50}','{"manual_inbox":true,"ai_drafts":true,"automation":false}',true,1),
 ('pro','Pro','احترافي',0,5,'{"IQD":{"monthly":null,"annual":null},"USD":{"monthly":null,"annual":null}}','{"ai_generations":1000,"whatsapp_conversations":1000,"numbers":3,"products":300,"members":5,"faqs":100}','{"manual_inbox":true,"ai_drafts":true,"automation":true}',true,1),
 ('business','Business','أعمال',0,7,'{"IQD":{"monthly":null,"annual":null},"USD":{"monthly":null,"annual":null}}','{"ai_generations":3000,"whatsapp_conversations":3000,"numbers":5,"products":500,"members":10,"faqs":200}','{"manual_inbox":true,"ai_drafts":true,"automation":true}',true,1);
CREATE TABLE public.workspace_subscriptions (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE RESTRICT,
 plan_id text NOT NULL DEFAULT 'trial' REFERENCES public.subscription_plans(id),
 status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','canceled','expired')),
 interval text NOT NULL DEFAULT 'monthly' CHECK (interval IN ('monthly','annual')),
 currency text NOT NULL DEFAULT 'IQD' CHECK (currency IN ('IQD','USD')),
 trial_ends_at timestamptz NOT NULL,
 period_ends_at timestamptz NOT NULL,
 grace_ends_at timestamptz,
 revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (status <> 'trialing' OR plan_id = 'trial'),
 CHECK (grace_ends_at IS NULL OR grace_ends_at >= period_ends_at)
);
CREATE TABLE workspace_private.subscription_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 before_state jsonb, after_state jsonb NOT NULL,
 actor text NOT NULL, reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_private.subscription_usage (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 metric text NOT NULL CHECK (metric IN ('ai_generations','whatsapp_test_conversations')),
 period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
 used integer NOT NULL CHECK (used >= 0),
 PRIMARY KEY (workspace_id, metric, period_start),
 CHECK (period_end > period_start AND period_end <= period_start + interval '32 days')
);
CREATE TABLE workspace_private.subscription_reservations (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 metric text NOT NULL, operation_key text NOT NULL CHECK (char_length(operation_key) BETWEEN 1 AND 200),
 period_start timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (workspace_id, metric, operation_key),
 FOREIGN KEY (workspace_id, metric, period_start) REFERENCES workspace_private.subscription_usage(workspace_id, metric, period_start)
);
-- These are future storage contracts ONLY. No INSERT grants, API, or verifier.
CREATE TABLE workspace_private.billing_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 plan_id text NOT NULL REFERENCES public.subscription_plans(id), plan_version integer NOT NULL CHECK (plan_version > 0),
 subscription_revision integer NOT NULL CHECK (subscription_revision >= 0),
 currency text NOT NULL CHECK (currency IN ('IQD','USD')), amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
 interval text NOT NULL CHECK (interval IN ('monthly','annual')),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
 status text NOT NULL CHECK (status IN ('draft','issued','paid','void','refunded')),
 UNIQUE (workspace_id,id)
);
CREATE TABLE workspace_private.billing_events (
 provider text NOT NULL, event_id text NOT NULL, workspace_id uuid NOT NULL,
 invoice_id uuid NOT NULL, payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK (kind IN ('payment_succeeded','payment_failed','renewed','canceled','refunded')),
 verified_at timestamptz NOT NULL, processed_at timestamptz,
 PRIMARY KEY(provider,event_id),
 FOREIGN KEY (workspace_id,invoice_id) REFERENCES workspace_private.billing_invoices(workspace_id,id)
);
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_plans, public.workspace_subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.subscription_plans, public.workspace_subscriptions TO authenticated;
CREATE POLICY subscription_plans_read ON public.subscription_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY subscriptions_owner_read ON public.workspace_subscriptions FOR SELECT TO authenticated USING (workspace_private.is_workspace_owner(workspace_id));
ALTER TABLE workspace_private.subscription_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_private.subscription_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_private.subscription_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_private.billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_private.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_private.subscription_audit, workspace_private.subscription_usage, workspace_private.subscription_reservations, workspace_private.billing_invoices, workspace_private.billing_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE workspace_private.subscription_audit_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION workspace_private.audit_subscription() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 INSERT INTO workspace_private.subscription_audit(workspace_id,before_state,after_state,actor,reason)
 VALUES (NEW.workspace_id,CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW),coalesce(auth.uid()::text,session_user),
   coalesce(nullif(current_setting('wasla.billing_reason',true),''),'Trial initialized'));
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_audit AFTER INSERT OR UPDATE ON public.workspace_subscriptions FOR EACH ROW EXECUTE FUNCTION workspace_private.audit_subscription();
CREATE FUNCTION workspace_private.initialize_subscription() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE deadline timestamptz;
BEGIN
 SELECT now() + trial_days * interval '1 day' INTO deadline FROM public.subscription_plans WHERE id = 'trial';
 INSERT INTO public.workspace_subscriptions(workspace_id,trial_ends_at,period_ends_at) VALUES(NEW.id,deadline,deadline);
 RETURN NEW;
END $$;
CREATE TRIGGER initialize_subscription AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION workspace_private.initialize_subscription();
-- Existing tenants get one trial at migration time, never a paid entitlement.
INSERT INTO public.workspace_subscriptions(workspace_id,trial_ends_at,period_ends_at)
 SELECT w.id, now() + p.trial_days * interval '1 day', now() + p.trial_days * interval '1 day'
 FROM public.workspaces w CROSS JOIN public.subscription_plans p WHERE p.id = 'trial';

CREATE FUNCTION workspace_private.subscription_access(s public.workspace_subscriptions) RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT s.status <> 'expired' AND now() < CASE s.status WHEN 'trialing' THEN s.trial_ends_at WHEN 'past_due' THEN s.grace_ends_at ELSE s.period_ends_at END;
$$;
CREATE FUNCTION workspace_private.subscription_limit(w uuid, metric text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.workspace_subscriptions%ROWTYPE; maximum integer;
BEGIN
 SELECT * INTO STRICT s FROM public.workspace_subscriptions WHERE workspace_id = w;
 -- NULL (for example past_due without a grace deadline) must deny capacity.
 IF workspace_private.subscription_access(s) IS NOT TRUE THEN RETURN 0; END IF;
 SELECT (limits ->> metric)::integer INTO maximum FROM public.subscription_plans WHERE id = s.plan_id;
 RETURN coalesce(maximum,0);
END $$;
-- Private, fixed-unit, transaction-scoped meter. Caller cannot supply prices,
-- units or dates. Every caller first locks the workspace to serialize mutations.
CREATE FUNCTION workspace_private.reserve_subscription_unit(w uuid, metric text, operation text, maximum integer) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE bucket timestamptz := date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'; fresh integer;
BEGIN
 IF EXISTS (SELECT 1 FROM workspace_private.subscription_reservations WHERE workspace_id=w AND subscription_reservations.metric=$2 AND operation_key=operation) THEN RETURN false; END IF;
 INSERT INTO workspace_private.subscription_usage(workspace_id,metric,period_start,period_end,used)
 VALUES(w,metric,bucket,bucket + interval '1 month',0) ON CONFLICT DO NOTHING;
 UPDATE workspace_private.subscription_usage SET used=used+1 WHERE workspace_id=w AND subscription_usage.metric=$2 AND period_start=bucket AND used < maximum RETURNING used INTO fresh;
 IF fresh IS NULL THEN RAISE EXCEPTION 'Subscription quota reached' USING ERRCODE='54000'; END IF;
 INSERT INTO workspace_private.subscription_reservations(workspace_id,metric,operation_key,period_start) VALUES(w,metric,operation,bucket);
 RETURN true;
END $$;
CREATE FUNCTION public.reserve_subscription_ai(p_workspace_id uuid,p_conversation_id uuid,p_revision integer,p_surface text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE fresh boolean;
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF p_surface IS NULL OR p_surface NOT IN ('studio','inbox') OR p_revision IS NULL OR NOT EXISTS (
 SELECT 1 FROM public.ai_conversations WHERE workspace_id=p_workspace_id AND id=p_conversation_id AND revision=p_revision AND status='open') THEN RAISE EXCEPTION 'Invalid generation' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.workspace_subscriptions s JOIN public.subscription_plans p ON p.id=s.plan_id WHERE s.workspace_id=p_workspace_id AND workspace_private.subscription_access(s) AND p.features->'ai_drafts'='true'::jsonb) THEN RAISE EXCEPTION 'AI entitlement unavailable' USING ERRCODE='42501'; END IF;
 -- Shared key across both entry points prevents cross-surface retry bypass.
 fresh := workspace_private.reserve_subscription_unit(p_workspace_id,'ai_generations',p_conversation_id::text || ':' || p_revision::text,workspace_private.subscription_limit(p_workspace_id,'ai_generations'));
 IF fresh THEN PERFORM public.reserve_ai_preview(p_workspace_id); END IF;
 RETURN fresh;
END $$;
REVOKE ALL ON FUNCTION public.reserve_subscription_ai(uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_subscription_ai(uuid,uuid,integer,text) TO authenticated;

-- Database guards cover existing RPCs, privileged ingestion and future writes.
-- Updates of business data remain allowed over quota; moving tenants is denied.
CREATE FUNCTION workspace_private.guard_subscription_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE metric text := TG_ARGV[0]; existing bigint; maximum integer;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN RAISE EXCEPTION 'Tenant reassignment denied' USING ERRCODE='42501'; END IF;
   RETURN NEW;
 END IF;
 PERFORM 1 FROM public.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 maximum := workspace_private.subscription_limit(NEW.workspace_id,metric);
 CASE metric
 WHEN 'products' THEN SELECT count(*) INTO existing FROM public.business_products WHERE workspace_id=NEW.workspace_id;
 WHEN 'faqs' THEN SELECT count(*) INTO existing FROM public.business_faqs WHERE workspace_id=NEW.workspace_id;
 WHEN 'numbers' THEN SELECT count(*) INTO existing FROM public.whatsapp_connections WHERE workspace_id=NEW.workspace_id;
 WHEN 'members' THEN SELECT count(*) INTO existing FROM public.workspace_members WHERE workspace_id=NEW.workspace_id;
 ELSE RAISE EXCEPTION 'Unknown capacity'; END CASE;
 IF existing >= maximum THEN RAISE EXCEPTION 'Subscription capacity reached' USING ERRCODE='54000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_products BEFORE INSERT OR UPDATE ON public.business_products FOR EACH ROW EXECUTE FUNCTION workspace_private.guard_subscription_capacity('products');
CREATE TRIGGER subscription_faqs BEFORE INSERT OR UPDATE ON public.business_faqs FOR EACH ROW EXECUTE FUNCTION workspace_private.guard_subscription_capacity('faqs');
CREATE TRIGGER subscription_numbers BEFORE INSERT OR UPDATE ON public.whatsapp_connections FOR EACH ROW EXECUTE FUNCTION workspace_private.guard_subscription_capacity('numbers');
CREATE TRIGGER subscription_members BEFORE INSERT OR UPDATE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION workspace_private.guard_subscription_capacity('members');
CREATE FUNCTION workspace_private.meter_subscription_conversation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.channel IS DISTINCT FROM OLD.channel THEN RAISE EXCEPTION 'Conversation identity immutable' USING ERRCODE='42501'; END IF;
 ELSIF NEW.channel='whatsapp_test' THEN
  PERFORM 1 FROM public.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
  -- Lifetime row identity is the operation key, not customer-controlled text.
  PERFORM workspace_private.reserve_subscription_unit(NEW.workspace_id,'whatsapp_test_conversations',NEW.id::text,workspace_private.subscription_limit(NEW.workspace_id,'whatsapp_conversations'));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_conversations AFTER INSERT OR UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION workspace_private.meter_subscription_conversation();

CREATE FUNCTION public.get_workspace_billing(p_workspace_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.workspace_subscriptions%ROWTYPE; counts jsonb; bucket timestamptz := date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT s FROM public.workspace_subscriptions WHERE workspace_id=p_workspace_id;
 SELECT coalesce(jsonb_object_agg(metric,used),'{}') INTO counts FROM workspace_private.subscription_usage WHERE workspace_id=p_workspace_id AND period_start=bucket;
 counts := counts || jsonb_build_object('products',(SELECT count(*) FROM public.business_products WHERE workspace_id=p_workspace_id),'faqs',(SELECT count(*) FROM public.business_faqs WHERE workspace_id=p_workspace_id),'numbers',(SELECT count(*) FROM public.whatsapp_connections WHERE workspace_id=p_workspace_id),'members',(SELECT count(*) FROM public.workspace_members WHERE workspace_id=p_workspace_id));
 RETURN jsonb_build_object('subscription',to_jsonb(s),'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.limits->>'products') FROM public.subscription_plans p),'usage',counts,'period_start',bucket,'period_end',bucket+interval '1 month');
END $$;
REVOKE ALL ON FUNCTION public.get_workspace_billing(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_billing(uuid) TO authenticated;

-- Operator-only transition contract. Paid activation/renewal deliberately disabled.
-- All deadlines use trusted DB time/config; optimistic revision rejects replay.
CREATE FUNCTION workspace_private.transition_subscription(w uuid,expected_revision integer,next_status text,next_plan text,reason text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.workspace_subscriptions%ROWTYPE; grace integer;
BEGIN
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 SELECT * INTO STRICT s FROM public.workspace_subscriptions WHERE workspace_id=w FOR UPDATE;
 IF s.revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'Stale subscription' USING ERRCODE='40001'; END IF;
 IF reason IS NULL OR char_length(reason) NOT BETWEEN 1 AND 500 OR next_status IS NULL OR next_status NOT IN ('past_due','canceled','expired') THEN RAISE EXCEPTION 'Unverified transition denied' USING ERRCODE='42501'; END IF;
 IF next_plan IS DISTINCT FROM s.plan_id AND NOT EXISTS (SELECT 1 FROM public.subscription_plans oldp JOIN public.subscription_plans newp ON newp.id=next_plan WHERE oldp.id=s.plan_id AND (newp.limits->>'products')::integer <= (oldp.limits->>'products')::integer) THEN RAISE EXCEPTION 'Upgrade disabled' USING ERRCODE='42501'; END IF;
 IF next_status='past_due' AND (s.status <> 'active' OR s.period_ends_at > now()) THEN RAISE EXCEPTION 'Invalid grace transition'; END IF;
 IF s.status='expired' OR (s.status='canceled' AND next_status <> 'expired') THEN RAISE EXCEPTION 'Terminal transition'; END IF;
 SELECT grace_days INTO STRICT grace FROM public.subscription_plans WHERE id=next_plan;
 PERFORM set_config('wasla.billing_reason',reason,true);
 UPDATE public.workspace_subscriptions SET plan_id=next_plan,status=next_status,revision=revision+1,updated_at=now(),
 grace_ends_at=CASE WHEN next_status='past_due' THEN period_ends_at + grace * interval '1 day' ELSE NULL END WHERE workspace_id=w;
END $$;
-- All private functions have explicit deny ACLs; trigger execution does not
-- require client EXECUTE grants. No trusted billing write role is provisioned.
REVOKE ALL ON FUNCTION workspace_private.audit_subscription(),workspace_private.initialize_subscription(),workspace_private.subscription_access(public.workspace_subscriptions),workspace_private.subscription_limit(uuid,text),workspace_private.reserve_subscription_unit(uuid,text,text,integer),workspace_private.guard_subscription_capacity(),workspace_private.meter_subscription_conversation(),workspace_private.transition_subscription(uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

-- Verified durable intake is independent from entitlement-controlled projection.
-- At most 1000 unresolved text events per workspace; hard overflow is never ACKed.
CREATE TABLE workspace_private.whatsapp_intake (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 intake_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 inbound_id uuid NOT NULL, connection_id uuid NOT NULL, sender_id text NOT NULL CHECK (sender_id ~ '^[0-9]{5,32}$'),
 status text NOT NULL DEFAULT 'deferred' CHECK (status IN ('deferred','failed','processed')),
 reason text NOT NULL DEFAULT 'pending' CHECK (reason IN ('pending','quota','predecessor','connection_disabled','processing_error','retry_exhausted','processed')),
 failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 5),
 received_at timestamptz NOT NULL, last_attempt_at timestamptz, processed_at timestamptz,
 PRIMARY KEY (workspace_id,inbound_id),
 FOREIGN KEY (workspace_id,inbound_id) REFERENCES public.whatsapp_inbound_messages(workspace_id,id),
 FOREIGN KEY (workspace_id,connection_id) REFERENCES public.whatsapp_connections(workspace_id,id),
 CHECK ((status='processed') = (processed_at IS NOT NULL))
);
CREATE INDEX whatsapp_intake_pending_idx ON workspace_private.whatsapp_intake(workspace_id,intake_order) WHERE status <> 'processed';
CREATE INDEX whatsapp_intake_customer_idx ON workspace_private.whatsapp_intake(workspace_id,connection_id,sender_id,intake_order) WHERE status <> 'processed';
CREATE INDEX whatsapp_intake_connection_idx ON workspace_private.whatsapp_intake(workspace_id,connection_id);
CREATE TABLE workspace_private.whatsapp_intake_reconciliation (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id), last_run_at timestamptz NOT NULL
);
ALTER TABLE workspace_private.whatsapp_intake OWNER TO postgres;
ALTER TABLE workspace_private.whatsapp_intake_reconciliation OWNER TO postgres;
ALTER TABLE workspace_private.whatsapp_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_private.whatsapp_intake_reconciliation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_private.whatsapp_intake,workspace_private.whatsapp_intake_reconciliation FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE workspace_private.whatsapp_intake_intake_order_seq FROM PUBLIC,anon,authenticated,service_role;

-- Internal only. Callers hold workspace FOR UPDATE before reaching this function.
CREATE FUNCTION workspace_private.process_whatsapp_intake(w uuid, source_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE q workspace_private.whatsapp_intake%ROWTYPE; i public.whatsapp_inbound_messages%ROWTYPE; c uuid; pos integer;
BEGIN
 SELECT * INTO STRICT q FROM workspace_private.whatsapp_intake WHERE workspace_id=w AND inbound_id=source_id FOR UPDATE;
 IF q.status='processed' THEN RETURN 'processed'; END IF;
 IF q.failures >= 5 THEN RETURN 'retry_exhausted'; END IF;
 -- Do not project a newer event ahead of an unresolved event for this customer.
 IF EXISTS (SELECT 1 FROM workspace_private.whatsapp_intake p WHERE p.workspace_id=w AND p.connection_id=q.connection_id AND p.sender_id=q.sender_id
  AND p.status <> 'processed' AND p.intake_order < q.intake_order) THEN
  UPDATE workspace_private.whatsapp_intake SET reason='predecessor',last_attempt_at=clock_timestamp() WHERE workspace_id=w AND inbound_id=source_id;
  RETURN 'predecessor';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.whatsapp_connections WHERE workspace_id=w AND id=q.connection_id AND is_test AND status='active' FOR SHARE) THEN
  UPDATE workspace_private.whatsapp_intake SET reason='connection_disabled',last_attempt_at=clock_timestamp() WHERE workspace_id=w AND inbound_id=source_id;
  RETURN 'connection_disabled';
 END IF;
 SELECT * INTO STRICT i FROM public.whatsapp_inbound_messages WHERE workspace_id=w AND id=source_id AND connection_id=q.connection_id AND message_type='text';
 -- Only projection/usage/state changes are rolled back by this subtransaction.
 BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_messages WHERE workspace_id=w AND inbound_message_id=source_id) THEN
   UPDATE workspace_private.whatsapp_intake SET status='processed',reason='processed',processed_at=clock_timestamp() WHERE workspace_id=w AND inbound_id=source_id;
   RETURN 'processed';
  END IF;
  SELECT id INTO c FROM public.ai_conversations WHERE workspace_id=w AND connection_id=q.connection_id AND customer_wa_id=q.sender_id FOR UPDATE;
  IF c IS NULL THEN
   -- The Phase 8 AFTER INSERT meter remains authoritative and atomic.
   INSERT INTO public.ai_conversations(workspace_id,channel,connection_id,customer_wa_id,title)
   VALUES(w,'whatsapp_test',q.connection_id,q.sender_id,'Test customer · ' || right(q.sender_id,4)) RETURNING id INTO c;
  END IF;
  SELECT coalesce(max(position),0)+1 INTO pos FROM public.ai_messages WHERE workspace_id=w AND conversation_id=c;
  INSERT INTO public.ai_messages(workspace_id,conversation_id,position,role,content,provider,inbound_message_id)
   VALUES(w,c,pos,'user',i.body,'customer',source_id);
  UPDATE public.ai_conversations SET revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=w AND id=c;
  UPDATE workspace_private.whatsapp_intake SET status='processed',reason='processed',last_attempt_at=clock_timestamp(),processed_at=clock_timestamp() WHERE workspace_id=w AND inbound_id=source_id;
  RETURN 'processed';
 EXCEPTION WHEN SQLSTATE '54000' THEN
  UPDATE workspace_private.whatsapp_intake SET status='deferred',reason='quota',last_attempt_at=clock_timestamp() WHERE workspace_id=w AND inbound_id=source_id;
  RETURN 'quota';
 WHEN OTHERS THEN
  -- No SQLERRM, raw payload, contact profile or provider exception is exposed.
  -- Infrastructure errors outside this protected block still fail acceptance.
  UPDATE workspace_private.whatsapp_intake SET status='failed',failures=failures+1,
   reason=CASE WHEN failures+1 >= 5 THEN 'retry_exhausted' ELSE 'processing_error' END,last_attempt_at=clock_timestamp()
   WHERE workspace_id=w AND inbound_id=source_id;
  RETURN 'processing_error';
 END;
END $$;
ALTER FUNCTION workspace_private.process_whatsapp_intake(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.process_whatsapp_intake(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Same RPC identity as Phase 5B; signature-verified server ingestion remains the
-- only service-role entry point. No caller-supplied tenant or entitlement data.
CREATE OR REPLACE FUNCTION public.ingest_whatsapp_ai_test_message(p_phone_number_id text,p_waba_id text,p_meta_message_id text,p_message_type text,p_body text,p_meta_timestamp timestamptz,p_sender_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w uuid; conn public.whatsapp_connections%ROWTYPE; i public.whatsapp_inbound_messages%ROWTYPE; fresh_id uuid; prior_sender text; outcome text;
BEGIN
 SELECT workspace_id INTO w FROM public.whatsapp_connections WHERE phone_number_id=p_phone_number_id AND waba_id=p_waba_id AND is_test;
 IF w IS NULL THEN RETURN 'ignored'; END IF; -- Explicitly outside trusted mapping.
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 SELECT * INTO STRICT conn FROM public.whatsapp_connections WHERE workspace_id=w AND phone_number_id=p_phone_number_id AND waba_id=p_waba_id AND is_test FOR SHARE;
 IF p_sender_id IS NOT NULL AND p_sender_id !~ '^[0-9]{5,32}$' THEN RAISE EXCEPTION 'Invalid sender' USING ERRCODE='22023'; END IF;
 INSERT INTO public.whatsapp_inbound_messages(workspace_id,connection_id,meta_message_id,message_type,body,meta_timestamp)
 VALUES(w,conn.id,p_meta_message_id,p_message_type,p_body,p_meta_timestamp) ON CONFLICT (meta_message_id) DO NOTHING RETURNING id INTO fresh_id;
 SELECT * INTO STRICT i FROM public.whatsapp_inbound_messages WHERE meta_message_id=p_meta_message_id;
 -- Global provider ID collisions may never acknowledge another tenant's event.
 IF i.workspace_id IS DISTINCT FROM w OR i.connection_id IS DISTINCT FROM conn.id OR i.message_type IS DISTINCT FROM p_message_type
  OR i.body IS DISTINCT FROM p_body OR i.meta_timestamp IS DISTINCT FROM p_meta_timestamp THEN
  RAISE EXCEPTION 'Inbound identity conflict' USING ERRCODE='22023';
 END IF;
 IF p_message_type='text' AND p_sender_id IS NOT NULL THEN
  SELECT sender_id INTO prior_sender FROM workspace_private.whatsapp_intake WHERE workspace_id=w AND inbound_id=i.id;
  IF prior_sender IS NOT NULL AND prior_sender IS DISTINCT FROM p_sender_id THEN RAISE EXCEPTION 'Inbound identity conflict' USING ERRCODE='22023'; END IF;
  -- Replays never trigger processing or consume retry/quota budgets. Old Phase 5B
  -- projected rows need no intake backfill; retained-but-unprojected rows can enroll.
  IF EXISTS (SELECT 1 FROM public.ai_messages m JOIN public.ai_conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id
   WHERE m.workspace_id=w AND m.inbound_message_id=i.id AND c.customer_wa_id IS DISTINCT FROM p_sender_id) THEN RAISE EXCEPTION 'Inbound identity conflict' USING ERRCODE='22023'; END IF;
  IF prior_sender IS NOT NULL OR EXISTS (SELECT 1 FROM public.ai_messages WHERE workspace_id=w AND inbound_message_id=i.id) THEN RETURN 'duplicate'; END IF;
  INSERT INTO workspace_private.whatsapp_intake(workspace_id,inbound_id,connection_id,sender_id,received_at) VALUES(w,i.id,conn.id,p_sender_id,i.received_at);
  outcome := workspace_private.process_whatsapp_intake(w,i.id);
  IF outcome <> 'processed' THEN
   -- Evaluate after projection: a full deferred queue must not block a valid
   -- existing customer (or another processable event) that needs no queue slot.
   IF (SELECT count(*) FROM workspace_private.whatsapp_intake WHERE workspace_id=w AND status <> 'processed') > 1000 THEN
    RAISE EXCEPTION 'Durable intake capacity reached' USING ERRCODE='54000';
   END IF;
   RETURN 'deferred';
  END IF;
 END IF;
 RETURN CASE WHEN fresh_id IS NULL THEN 'duplicate' ELSE 'inserted' END;
END $$;
ALTER FUNCTION public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamptz,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamptz,text) TO service_role;
-- Retire the old raw-only service path to prevent bypassing bounded intake.
REVOKE ALL ON FUNCTION public.ingest_whatsapp_test_message(text,text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_whatsapp_intake(p_workspace_id uuid,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 975 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('capacity',1000,'outstanding',(SELECT count(*) FROM workspace_private.whatsapp_intake WHERE workspace_id=p_workspace_id AND status <> 'processed'),
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM (
  SELECT q.inbound_id,q.status,q.reason,q.failures,q.received_at,q.last_attempt_at,right(q.sender_id,4) AS customer_suffix,i.body
  FROM workspace_private.whatsapp_intake q JOIN public.whatsapp_inbound_messages i ON i.workspace_id=q.workspace_id AND i.id=q.inbound_id AND i.connection_id=q.connection_id
  WHERE q.workspace_id=p_workspace_id AND q.status <> 'processed' ORDER BY q.intake_order LIMIT 25 OFFSET p_offset
 ) page),'[]'::jsonb));
END $$;
CREATE FUNCTION public.reconcile_whatsapp_intake(p_workspace_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q record; outcome text; attempted integer:=0; processed integer:=0; stamp timestamptz;
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 INSERT INTO workspace_private.whatsapp_intake_reconciliation(workspace_id,last_run_at) VALUES(p_workspace_id,clock_timestamp())
 ON CONFLICT (workspace_id) DO UPDATE SET last_run_at=EXCLUDED.last_run_at
 WHERE whatsapp_intake_reconciliation.last_run_at <= clock_timestamp()-interval '1 minute' RETURNING last_run_at INTO stamp;
 IF stamp IS NULL THEN RAISE EXCEPTION 'Reconciliation rate limited' USING ERRCODE='54000'; END IF;
 FOR q IN SELECT inbound_id FROM workspace_private.whatsapp_intake WHERE workspace_id=p_workspace_id AND status <> 'processed' AND failures < 5
  AND (last_attempt_at IS NULL OR last_attempt_at <= clock_timestamp()-interval '5 minutes')
  ORDER BY last_attempt_at NULLS FIRST,intake_order LIMIT 25
 LOOP
  attempted:=attempted+1;
  outcome:=workspace_private.process_whatsapp_intake(p_workspace_id,q.inbound_id);
  IF outcome='processed' THEN processed:=processed+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('attempted',attempted,'processed',processed);
END $$;
ALTER FUNCTION public.get_whatsapp_intake(uuid,integer) OWNER TO postgres;
ALTER FUNCTION public.reconcile_whatsapp_intake(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_whatsapp_intake(uuid,integer),public.reconcile_whatsapp_intake(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_intake(uuid,integer),public.reconcile_whatsapp_intake(uuid) TO authenticated;

CREATE FUNCTION workspace_private.guard_subscription_draft() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM public.workspace_subscriptions s JOIN public.subscription_plans p ON p.id=s.plan_id WHERE s.workspace_id=NEW.workspace_id AND workspace_private.subscription_access(s) AND p.features->(CASE WHEN NEW.provider='manual' THEN 'manual_inbox' ELSE 'ai_drafts' END)='true'::jsonb) THEN RAISE EXCEPTION 'Draft entitlement unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_drafts BEFORE INSERT ON public.whatsapp_reply_drafts FOR EACH ROW EXECUTE FUNCTION workspace_private.guard_subscription_draft();
REVOKE ALL ON FUNCTION workspace_private.guard_subscription_draft() FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX subscription_audit_workspace_idx ON workspace_private.subscription_audit(workspace_id,id);
CREATE INDEX billing_invoices_workspace_idx ON workspace_private.billing_invoices(workspace_id);
CREATE INDEX billing_events_invoice_idx ON workspace_private.billing_events(workspace_id,invoice_id);


-- Optional Phase 7B integration: no assumption that its schema exists. When it
-- is present, direct setting/run writes are subject to the same entitlement.
CREATE FUNCTION workspace_private.guard_subscription_automation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_TABLE_NAME='whatsapp_automation_settings' THEN
  IF NEW.mode='disabled' THEN RETURN NEW; END IF;
 ELSE
  -- Preserve human-request handoff even after expiry or downgrade.
  IF NEW.status='pending_human' THEN RETURN NEW; END IF;
 END IF;
 PERFORM 1 FROM public.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM public.workspace_subscriptions s JOIN public.subscription_plans p ON p.id=s.plan_id WHERE s.workspace_id=NEW.workspace_id AND workspace_private.subscription_access(s) AND p.features->'automation'='true'::jsonb) THEN RAISE EXCEPTION 'Automation entitlement unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION workspace_private.guard_subscription_automation() FROM PUBLIC,anon,authenticated,service_role;
DO $$
BEGIN
 IF to_regclass('public.whatsapp_automation_settings') IS NOT NULL THEN
  EXECUTE 'CREATE TRIGGER subscription_automation_settings BEFORE INSERT OR UPDATE ON public.whatsapp_automation_settings FOR EACH ROW EXECUTE FUNCTION workspace_private.guard_subscription_automation()';
  EXECUTE 'CREATE TRIGGER subscription_automation_runs BEFORE INSERT OR UPDATE ON public.whatsapp_automation_runs FOR EACH ROW EXECUTE FUNCTION workspace_private.guard_subscription_automation()';
 END IF;
END $$;

COMMIT;

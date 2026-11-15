-- PENDING REVIEW ONLY. Requires the already-applied compatible Phase 8 + 7A/7B.
-- Pending for hosted development; verified only in disposable local PostgreSQL.
-- Never replay historical installers.
-- Provider execution remains independently disabled in application code.
BEGIN;
DO $$DECLARE object_name text; BEGIN
 FOREACH object_name IN ARRAY ARRAY['workspace_private.cloud_access','workspace_private.cloud_number_capacity','public.begin_cloud_signup','public.cloud_signup_control','workspace_private.apply_cloud_status','public.accept_cloud_event','workspace_private.cloud_job_snapshot','public.cloud_worker','public.manage_cloud','public.save_cloud_manual_draft','public.get_cloud_workspace','public.create_workspace_invitation','public.accept_workspace_invitation','public.revoke_workspace_invitation','public.get_workspace_invitations','public.get_workspace_team','public.remove_workspace_member','public.request_subscription_review','public.get_subscription_requests','public.withdraw_subscription_request','workspace_private.review_subscription_request','workspace_private.review_cloud_attempt','public.rotate_cloud_credential','public.cloud_audio_for_owner'] LOOP
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=split_part(object_name,'.',1) AND p.proname=split_part(object_name,'.',2)) THEN RAISE EXCEPTION 'New function name collision: %',object_name; END IF;
 END LOOP;
 IF current_user <> 'postgres' OR to_regclass('public.wasla_subscription_plans') IS NULL
 OR to_regprocedure('workspace_private.reserve_subscription_unit(uuid,text,text,integer)') IS NULL
 THEN RAISE EXCEPTION 'Compatible Phase 8 and postgres migration administrator required'; END IF;
END$$;

CREATE TABLE public.cloud_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 phone_id text UNIQUE CHECK(phone_id ~ '^[0-9]{1,32}$'),waba_id text CHECK(waba_id ~ '^[0-9]{1,32}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','active','disabled','error')),
 mode text NOT NULL DEFAULT 'review' CHECK(mode IN ('review','automatic')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),CHECK(status NOT IN ('active','verified') OR (phone_id IS NOT NULL AND waba_id IS NOT NULL))
);
CREATE TABLE workspace_private.cloud_pilot_workspaces (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id),approved boolean NOT NULL DEFAULT false,reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_private.cloud_credentials (
 workspace_id uuid NOT NULL,channel_id uuid PRIMARY KEY,sealed jsonb NOT NULL CHECK(jsonb_typeof(sealed)='object'),expires_at timestamptz NOT NULL,
 FOREIGN KEY(workspace_id,channel_id) REFERENCES public.cloud_channels(workspace_id,id)
);
CREATE TABLE workspace_private.cloud_signups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,channel_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),state_hash bytea NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','connected','failed')),
 FOREIGN KEY(workspace_id,channel_id) REFERENCES public.cloud_channels(workspace_id,id)
);
CREATE TABLE public.cloud_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,channel_id uuid NOT NULL,
 customer_id text NOT NULL CHECK(customer_id ~ '^[0-9]{5,32}$'),human_takeover boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),last_customer_at timestamptz NOT NULL,
 UNIQUE(channel_id,customer_id),UNIQUE(workspace_id,id),UNIQUE(workspace_id,id,channel_id),
 FOREIGN KEY(workspace_id,channel_id) REFERENCES public.cloud_channels(workspace_id,id)
);
CREATE TABLE workspace_private.cloud_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,channel_id uuid NOT NULL,thread_id uuid,
 intake_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,thread_revision integer,
 event_key text NOT NULL UNIQUE CHECK(char_length(event_key)<=600),source_id text NOT NULL CHECK(char_length(source_id) BETWEEN 1 AND 512),
 kind text NOT NULL CHECK(kind IN ('text','audio','unsupported','status')),sender text NOT NULL CHECK(sender ~ '^[0-9]{5,32}$'),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=20000),source_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','deferred','done','review','delivery_pending')),
 lease uuid,lease_until timestamptz,audio_started_at timestamptz,attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT now(),reason text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,id,thread_id),FOREIGN KEY(workspace_id,channel_id) REFERENCES public.cloud_channels(workspace_id,id),
 FOREIGN KEY(workspace_id,thread_id,channel_id) REFERENCES public.cloud_threads(workspace_id,id,channel_id)
);
CREATE UNIQUE INDEX cloud_source_once ON workspace_private.cloud_jobs(source_id) WHERE kind<>'status';
CREATE INDEX cloud_jobs_ready ON workspace_private.cloud_jobs(available_at,created_at) WHERE state IN ('queued','deferred','leased');
CREATE TABLE public.cloud_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,thread_id uuid NOT NULL,source_job uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('customer','assistant')),content text CHECK(char_length(content) BETWEEN 1 AND 6000),
 kind text NOT NULL CHECK(kind IN ('text','audio','unsupported')),CHECK(kind<>'text' OR content IS NOT NULL),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_job,role),FOREIGN KEY(workspace_id,thread_id) REFERENCES public.cloud_threads(workspace_id,id),
 FOREIGN KEY(workspace_id,source_job,thread_id) REFERENCES workspace_private.cloud_jobs(workspace_id,id,thread_id)
);
CREATE INDEX cloud_messages_thread ON public.cloud_messages(workspace_id,thread_id,created_at,id);
CREATE TABLE public.cloud_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,thread_id uuid NOT NULL,job_id uuid NOT NULL UNIQUE,
 source_revision integer NOT NULL,revision integer NOT NULL DEFAULT 0,provider text NOT NULL DEFAULT 'ai' CHECK(provider IN ('ai','manual')),content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 4096),
 approved_by uuid REFERENCES auth.users(id),approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,thread_id) REFERENCES public.cloud_threads(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id,thread_id) REFERENCES workspace_private.cloud_jobs(workspace_id,id,thread_id)
);
CREATE TABLE workspace_private.cloud_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,draft_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'dispatching' CHECK(status IN ('dispatching','unknown','rejected','failed','accepted','sent','delivered','read')),
 content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 4096),provider_id text UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 retryable boolean NOT NULL DEFAULT false,retry_after timestamptz,
 FOREIGN KEY(workspace_id,draft_id) REFERENCES public.cloud_drafts(workspace_id,id)
);
CREATE UNIQUE INDEX cloud_attempt_one_uncertain_or_success ON workspace_private.cloud_attempts(draft_id) WHERE status IN ('dispatching','unknown','accepted','sent','delivered','read');
CREATE TABLE workspace_private.cloud_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 actor_id uuid,event text NOT NULL CHECK(event IN ('signup_started','connected','connection_failed','takeover','mode','approved','disabled','invited','joined','invite_revoked','plan_requested','plan_reviewed','plan_withdrawn','credential_rotated','member_removed','delivery_reviewed')),
 object_id uuid,created_at timestamptz NOT NULL DEFAULT now()
);
-- Independent provisional Cloud/voice budgets; test conversation quotas remain
-- unchanged and clearly separate. Features are OFF until a reviewed activation.
UPDATE public.wasla_subscription_plans SET limits=limits||jsonb_build_object('cloud_conversations',0,'audio_transcriptions',0),
 features=features||jsonb_build_object('cloud_messaging',false,'voice',false);
ALTER TABLE workspace_private.subscription_usage DROP CONSTRAINT subscription_usage_metric_check;
ALTER TABLE workspace_private.subscription_usage ADD CONSTRAINT subscription_usage_metric_check CHECK(metric IN ('ai_generations','whatsapp_test_conversations','whatsapp_cloud_conversations','audio_transcriptions'));

DO $$DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['cloud_channels','cloud_threads','cloud_messages','cloud_drafts'] LOOP
  EXECUTE format('ALTER TABLE public.%I OWNER TO postgres',n);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',n);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',n);
  EXECUTE format('CREATE POLICY cloud_owner_read ON public.%I FOR SELECT TO authenticated USING (workspace_private.is_workspace_owner(workspace_id))',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['cloud_pilot_workspaces','cloud_credentials','cloud_signups','cloud_jobs','cloud_attempts','cloud_audit'] LOOP
  EXECUTE format('ALTER TABLE workspace_private.%I OWNER TO postgres',n);
  EXECUTE format('ALTER TABLE workspace_private.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON workspace_private.%I FROM PUBLIC,anon,authenticated,service_role',n);
 END LOOP;
END$$;
REVOKE ALL ON SEQUENCE workspace_private.cloud_audit_id_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION workspace_private.cloud_access(w uuid,feature text) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspace_subscriptions s JOIN public.wasla_subscription_plans p ON p.id=s.plan_id
 WHERE s.workspace_id=w AND EXISTS(SELECT 1 FROM workspace_private.cloud_pilot_workspaces WHERE workspace_id=w AND approved) AND workspace_private.subscription_access(s) IS TRUE AND p.features->feature='true'::jsonb);
$$;
CREATE FUNCTION workspace_private.cloud_number_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE total bigint;maximum integer;
BEGIN
 PERFORM 1 FROM public.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 maximum:=workspace_private.subscription_limit(NEW.workspace_id,'numbers');
 SELECT (SELECT count(*) FROM public.whatsapp_connections WHERE workspace_id=NEW.workspace_id)+(SELECT count(*) FROM public.cloud_channels WHERE workspace_id=NEW.workspace_id) INTO total;
 IF total+(CASE WHEN TG_WHEN='BEFORE' THEN 1 ELSE 0 END)>maximum THEN RAISE EXCEPTION 'Number capacity reached' USING ERRCODE='54000'; END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER cloud_number_capacity BEFORE INSERT ON public.cloud_channels FOR EACH ROW EXECUTE FUNCTION workspace_private.cloud_number_capacity();
CREATE TRIGGER cloud_legacy_number_capacity AFTER INSERT ON public.whatsapp_connections FOR EACH ROW EXECUTE FUNCTION workspace_private.cloud_number_capacity();

CREATE FUNCTION public.begin_cloud_signup(p_workspace_id uuid,p_channel_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cloud_channels%ROWTYPE;nonce text;sid uuid;
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) OR NOT workspace_private.cloud_access(p_workspace_id,'cloud_messaging') THEN RAISE EXCEPTION 'Cloud access denied' USING ERRCODE='42501'; END IF;
 IF p_channel_id IS NOT NULL THEN
  SELECT * INTO STRICT c FROM public.cloud_channels WHERE workspace_id=p_workspace_id AND id=p_channel_id FOR UPDATE;
  IF c.status NOT IN ('pending','error','disabled') THEN RAISE EXCEPTION 'Channel already active'; END IF;
 ELSE
  SELECT * INTO c FROM public.cloud_channels WHERE workspace_id=p_workspace_id AND status IN ('pending','error') ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN INSERT INTO public.cloud_channels(workspace_id) VALUES(p_workspace_id) RETURNING * INTO c; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM workspace_private.cloud_signups WHERE channel_id=c.id AND ((status='claimed' AND expires_at>now()) OR (status='pending' AND created_at>now()-interval '1 minute'))) THEN RAISE EXCEPTION 'Signup already in progress' USING ERRCODE='54000'; END IF;
 UPDATE workspace_private.cloud_signups SET status='failed' WHERE channel_id=c.id AND status='pending';
 UPDATE public.cloud_channels SET status='pending',revision=revision+1 WHERE id=c.id;
 nonce:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 INSERT INTO workspace_private.cloud_signups(workspace_id,channel_id,actor_id,state_hash) VALUES(p_workspace_id,c.id,auth.uid(),sha256(convert_to(nonce,'UTF8'))) RETURNING id INTO sid;
 INSERT INTO workspace_private.cloud_audit(workspace_id,actor_id,event,object_id) VALUES(p_workspace_id,auth.uid(),'signup_started',sid);
 RETURN jsonb_build_object('state',nonce,'channelId',c.id,'expiresIn',600);
END$$;
CREATE FUNCTION public.cloud_signup_control(p_command text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s workspace_private.cloud_signups%ROWTYPE;c public.cloud_channels%ROWTYPE;w uuid;
BEGIN
 IF p_command='claim' THEN
  SELECT workspace_id INTO w FROM workspace_private.cloud_signups WHERE state_hash=sha256(convert_to(p_payload->>'state','UTF8'));
 ELSE SELECT workspace_id INTO w FROM workspace_private.cloud_signups WHERE id=(p_payload->>'attemptId')::uuid; END IF;
 IF w IS NULL THEN RAISE EXCEPTION 'Signup unavailable'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 IF p_command='claim' THEN
  SELECT * INTO STRICT s FROM workspace_private.cloud_signups WHERE workspace_id=w AND state_hash=sha256(convert_to(p_payload->>'state','UTF8')) FOR UPDATE;
  IF s.workspace_id IS DISTINCT FROM (p_payload->>'workspaceId')::uuid OR s.status<>'pending' OR s.actor_id IS DISTINCT FROM (p_payload->>'userId')::uuid OR s.expires_at<=now() OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=s.actor_id AND role='owner') THEN RAISE EXCEPTION 'Signup unavailable'; END IF;
  UPDATE workspace_private.cloud_signups SET status='claimed' WHERE id=s.id;
  RETURN jsonb_build_object('workspaceId',w,'channelId',s.channel_id,'attemptId',s.id);
 END IF;
 SELECT * INTO STRICT s FROM workspace_private.cloud_signups WHERE workspace_id=w AND id=(p_payload->>'attemptId')::uuid FOR UPDATE;
 IF s.status<>'claimed' OR s.expires_at<=now() OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=s.actor_id AND role='owner') THEN RAISE EXCEPTION 'Signup unavailable'; END IF;
 SELECT * INTO STRICT c FROM public.cloud_channels WHERE workspace_id=w AND id=s.channel_id FOR UPDATE;
 IF p_command='verified' THEN
  IF NOT workspace_private.cloud_access(w,'cloud_messaging') OR (c.phone_id IS NOT NULL AND (c.phone_id IS DISTINCT FROM p_payload->>'phoneId' OR c.waba_id IS DISTINCT FROM p_payload->>'wabaId')) OR (p_payload->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'Channel binding denied'; END IF;
  IF octet_length((p_payload->'token')::text)>16000 OR p_payload->'token'->>'version'<>'1' THEN RAISE EXCEPTION 'Invalid sealed credential'; END IF;
  UPDATE public.cloud_channels SET phone_id=p_payload->>'phoneId',waba_id=p_payload->>'wabaId',status='verified',revision=revision+1 WHERE id=c.id;
  INSERT INTO workspace_private.cloud_credentials(workspace_id,channel_id,sealed,expires_at) VALUES(w,c.id,p_payload->'token',(p_payload->>'expiresAt')::timestamptz)
   ON CONFLICT(channel_id) DO UPDATE SET sealed=EXCLUDED.sealed,expires_at=EXCLUDED.expires_at;
 ELSIF p_command='activate' THEN
  IF c.status<>'verified' OR NOT workspace_private.cloud_access(w,'cloud_messaging') OR NOT EXISTS(SELECT 1 FROM workspace_private.cloud_credentials WHERE channel_id=c.id AND expires_at>now()) THEN RAISE EXCEPTION 'Channel not verified'; END IF;
  UPDATE public.cloud_channels SET status='active',revision=revision+1 WHERE id=c.id;
  UPDATE workspace_private.cloud_signups SET status='connected' WHERE id=s.id;
  INSERT INTO workspace_private.cloud_audit(workspace_id,actor_id,event,object_id) VALUES(w,s.actor_id,'connected',c.id);
 ELSIF p_command='fail' THEN
  UPDATE public.cloud_channels SET status='error',revision=revision+1 WHERE id=c.id;
  UPDATE workspace_private.cloud_signups SET status='failed' WHERE id=s.id;
  INSERT INTO workspace_private.cloud_audit(workspace_id,actor_id,event,object_id) VALUES(w,s.actor_id,'connection_failed',c.id);
 ELSE RAISE EXCEPTION 'Invalid signup command'; END IF;
 RETURN '{}'::jsonb;
END$$;

CREATE FUNCTION workspace_private.apply_cloud_status(channel uuid,s jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a workspace_private.cloud_attempts%ROWTYPE;d public.cloud_drafts%ROWTYPE;next_rank integer;old_rank integer;
BEGIN
 IF s->>'status' NOT IN ('sent','delivered','read','failed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
 SELECT attempts.* INTO a FROM workspace_private.cloud_attempts attempts JOIN public.cloud_drafts draft ON draft.id=attempts.draft_id AND draft.workspace_id=attempts.workspace_id
 JOIN public.cloud_threads thread ON thread.id=draft.thread_id AND thread.workspace_id=draft.workspace_id
 WHERE thread.channel_id=channel AND thread.customer_id=s->>'recipient_id'
 AND (attempts.provider_id=s->>'id' OR (s->>'biz_opaque_callback_data' IS NOT NULL AND attempts.id=(s->>'biz_opaque_callback_data')::uuid)) FOR UPDATE OF attempts;
 IF NOT FOUND THEN RETURN false; END IF;
 IF a.provider_id IS NOT NULL AND a.provider_id IS DISTINCT FROM s->>'id' THEN RAISE EXCEPTION 'Status identity conflict'; END IF;
 next_rank:=CASE s->>'status' WHEN 'failed' THEN 3 WHEN 'sent' THEN 4 WHEN 'delivered' THEN 5 WHEN 'read' THEN 6 END;
 old_rank:=CASE a.status WHEN 'accepted' THEN 2 WHEN 'failed' THEN 3 WHEN 'sent' THEN 4 WHEN 'delivered' THEN 5 WHEN 'read' THEN 6 ELSE 1 END;
 UPDATE workspace_private.cloud_attempts SET provider_id=s->>'id',status=CASE WHEN next_rank>old_rank THEN s->>'status' ELSE status END,updated_at=now(),retryable=false WHERE id=a.id;
 SELECT * INTO STRICT d FROM public.cloud_drafts WHERE workspace_id=a.workspace_id AND id=a.draft_id;
 INSERT INTO public.cloud_messages(workspace_id,thread_id,source_job,role,kind,content)
 VALUES(d.workspace_id,d.thread_id,d.job_id,'assistant','text',a.content) ON CONFLICT(source_job,role) DO NOTHING;
 UPDATE workspace_private.cloud_jobs SET state='done',reason=NULL WHERE id=d.job_id AND workspace_id=d.workspace_id;
 RETURN true;
END$$;

CREATE FUNCTION public.accept_cloud_event(p_event jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cloud_channels%ROWTYPE;j workspace_private.cloud_jobs%ROWTYPE;compact jsonb;w uuid;
BEGIN
 -- Trusted mapping only; no tenant argument is accepted from a webhook.
 SELECT workspace_id INTO w FROM public.cloud_channels WHERE phone_id=p_event->>'phoneId' AND waba_id=p_event->>'wabaId';
 IF w IS NULL THEN RETURN 'ignored'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 SELECT * INTO STRICT c FROM public.cloud_channels WHERE workspace_id=w AND phone_id=p_event->>'phoneId' AND waba_id=p_event->>'wabaId';
 IF p_event->>'kind' NOT IN ('text','audio','unsupported','status') OR p_event->>'kind' IS NULL OR octet_length(p_event::text)>20000 THEN RAISE EXCEPTION 'Invalid event'; END IF;
 compact:=p_event-ARRAY['workspaceId','workspace_id'];
 SELECT * INTO j FROM workspace_private.cloud_jobs WHERE event_key=p_event->>'key';
 IF FOUND THEN
  IF j.workspace_id<>w OR j.channel_id<>c.id OR j.payload IS DISTINCT FROM compact THEN RAISE EXCEPTION 'Source identity conflict'; END IF;
  RETURN 'duplicate';
 END IF;
 IF p_event->>'kind'='status' AND workspace_private.apply_cloud_status(c.id,p_event->'status') THEN
  INSERT INTO workspace_private.cloud_jobs(workspace_id,channel_id,event_key,source_id,kind,sender,payload,source_at,state)
  VALUES(w,c.id,p_event->>'key',p_event->>'sourceId','status',p_event->>'sender',compact,least((p_event->>'timestamp')::timestamptz,clock_timestamp()),'done');
  RETURN 'accepted';
 END IF;
 IF (SELECT count(*) FROM workspace_private.cloud_jobs WHERE workspace_id=w AND state NOT IN ('done'))>=1000 THEN RAISE EXCEPTION 'Cloud intake capacity reached' USING ERRCODE='54000'; END IF;
 INSERT INTO workspace_private.cloud_jobs(workspace_id,channel_id,event_key,source_id,kind,sender,payload,source_at)
 VALUES(w,c.id,p_event->>'key',p_event->>'sourceId',p_event->>'kind',p_event->>'sender',compact,least((p_event->>'timestamp')::timestamptz,clock_timestamp()));
 RETURN 'accepted';
END$$;

CREATE FUNCTION workspace_private.cloud_job_snapshot(j workspace_private.cloud_jobs) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',j.id,'lease',j.lease,'workspaceId',j.workspace_id,'channelId',j.channel_id,'threadId',j.thread_id,'revision',j.thread_revision,
 'kind',j.kind,'text',coalesce(m.content,j.payload->>'body'),'audioId',j.payload->'audio'->>'id','audioHash',j.payload->'audio'->>'sha256',
 'sender',j.sender,'phoneId',c.phone_id,'lastCustomerAt',t.last_customer_at,'mode',CASE WHEN d.approved_at IS NOT NULL THEN 'automatic' ELSE c.mode END,'draftId',d.id)
 FROM public.cloud_channels c JOIN public.cloud_threads t ON t.workspace_id=c.workspace_id AND t.channel_id=c.id
 LEFT JOIN public.cloud_messages m ON m.source_job=j.id AND m.role='customer' AND m.workspace_id=j.workspace_id
 LEFT JOIN public.cloud_drafts d ON d.job_id=j.id AND d.workspace_id=j.workspace_id
 WHERE c.workspace_id=j.workspace_id AND c.id=j.channel_id AND t.id=j.thread_id;
$$;
CREATE FUNCTION public.cloud_worker(p_command text,p_job uuid DEFAULT NULL,p_lease uuid DEFAULT NULL,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record;j workspace_private.cloud_jobs%ROWTYPE;c public.cloud_channels%ROWTYPE;t public.cloud_threads%ROWTYPE;
 d public.cloud_drafts%ROWTYPE;a workspace_private.cloud_attempts%ROWTYPE;w uuid;new_thread uuid;fresh boolean;owner_id uuid;daily integer;maximum integer;manual_approved boolean;period_name text;period_max integer;window_used integer;
BEGIN
 IF p_command='claim' THEN
  FOR candidate IN SELECT id,workspace_id FROM (
   SELECT per_customer.*,row_number() OVER(PARTITION BY workspace_id ORDER BY available_at,intake_order) AS workspace_slot FROM (
    SELECT DISTINCT ON(workspace_id,channel_id,sender,(kind='status')) id,workspace_id,channel_id,sender,intake_order,available_at
    FROM workspace_private.cloud_jobs WHERE attempts<5 AND available_at<=now()
    AND (state IN ('queued','deferred') OR (state='leased' AND lease_until<=now()))
    ORDER BY workspace_id,channel_id,sender,(kind='status'),available_at,intake_order
   ) per_customer
  ) fair WHERE workspace_slot<=10 ORDER BY available_at,intake_order LIMIT 100
  LOOP
   PERFORM 1 FROM public.workspaces WHERE id=candidate.workspace_id FOR UPDATE SKIP LOCKED;
   IF NOT FOUND THEN CONTINUE; END IF;
   SELECT * INTO j FROM workspace_private.cloud_jobs WHERE id=candidate.id AND workspace_id=candidate.workspace_id FOR UPDATE SKIP LOCKED;
   IF NOT FOUND OR j.attempts>=5 OR j.available_at>now() OR NOT(j.state IN ('queued','deferred') OR (j.state='leased' AND j.lease_until<=now())) THEN CONTINUE; END IF;
   IF EXISTS(SELECT 1 FROM workspace_private.cloud_attempts attempt JOIN public.cloud_drafts draft ON draft.id=attempt.draft_id AND draft.workspace_id=attempt.workspace_id
    WHERE draft.job_id=j.id AND attempt.status IN ('dispatching','unknown','accepted','sent','delivered','read')) THEN
    UPDATE workspace_private.cloud_attempts SET status='unknown' WHERE draft_id IN (SELECT id FROM public.cloud_drafts WHERE job_id=j.id) AND status='dispatching';
    UPDATE workspace_private.cloud_jobs SET state='delivery_pending',reason='provider_reconciliation' WHERE id=j.id;CONTINUE;
   END IF;
   IF j.kind='status' THEN
    IF workspace_private.apply_cloud_status(j.channel_id,j.payload->'status') THEN UPDATE workspace_private.cloud_jobs SET state='done' WHERE id=j.id;
    ELSE UPDATE workspace_private.cloud_jobs SET state=CASE WHEN attempts>=4 THEN 'review' ELSE 'deferred' END,attempts=attempts+1,available_at=now()+interval '5 minutes',reason='unmatched_status' WHERE id=j.id; END IF;
    CONTINUE;
   END IF;
   SELECT * INTO STRICT c FROM public.cloud_channels WHERE workspace_id=j.workspace_id AND id=j.channel_id;
   IF c.status<>'active' THEN UPDATE workspace_private.cloud_jobs SET state='deferred',available_at=now()+interval '5 minutes',reason='channel_disabled' WHERE id=j.id;CONTINUE; END IF;
   IF EXISTS(SELECT 1 FROM workspace_private.cloud_jobs prior WHERE prior.workspace_id=j.workspace_id AND prior.channel_id=j.channel_id AND prior.sender=j.sender AND prior.kind<>'status' AND prior.intake_order<j.intake_order AND prior.state IN ('queued','deferred','leased')) THEN
    UPDATE workspace_private.cloud_jobs SET state='deferred',available_at=now()+interval '5 minutes',reason='predecessor' WHERE id=j.id;CONTINUE;
   END IF;
   BEGIN
    SELECT * INTO t FROM public.cloud_threads WHERE workspace_id=j.workspace_id AND channel_id=j.channel_id AND customer_id=j.sender FOR UPDATE;
    IF NOT FOUND THEN
     IF NOT workspace_private.cloud_access(j.workspace_id,'cloud_messaging') THEN RAISE EXCEPTION 'Cloud access denied'; END IF;
     new_thread:=gen_random_uuid();
     PERFORM workspace_private.reserve_subscription_unit(j.workspace_id,'whatsapp_cloud_conversations',new_thread::text,workspace_private.subscription_limit(j.workspace_id,'cloud_conversations'));
     INSERT INTO public.cloud_threads(id,workspace_id,channel_id,customer_id,last_customer_at) VALUES(new_thread,j.workspace_id,j.channel_id,j.sender,j.source_at) RETURNING * INTO t;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.cloud_messages WHERE source_job=j.id AND role='customer') THEN
     UPDATE workspace_private.cloud_jobs SET thread_id=t.id WHERE workspace_id=j.workspace_id AND id=j.id;
     INSERT INTO public.cloud_messages(workspace_id,thread_id,source_job,role,kind,content) VALUES(j.workspace_id,t.id,j.id,'customer',j.kind,j.payload->>'body');
     UPDATE public.cloud_threads SET revision=revision+1,last_customer_at=greatest(last_customer_at,j.source_at) WHERE id=t.id RETURNING * INTO t;
     UPDATE workspace_private.cloud_jobs SET thread_id=t.id,thread_revision=t.revision WHERE id=j.id RETURNING * INTO j;
    END IF;
   EXCEPTION WHEN OTHERS THEN
    -- Projection/usage rollback does not remove the accepted raw event.
    UPDATE workspace_private.cloud_jobs SET state='deferred',available_at=now()+interval '5 minutes',reason='capacity_or_projection' WHERE id=j.id;CONTINUE;
   END;
   IF j.kind='unsupported' THEN
    UPDATE public.cloud_threads SET human_takeover=true,revision=revision+1 WHERE id=t.id;
    UPDATE workspace_private.cloud_jobs SET state='review',reason='unsupported' WHERE id=j.id;CONTINUE;
   END IF;
   -- Accepted-but-not-yet-projected messages also invalidate older replies.
   IF EXISTS(SELECT 1 FROM workspace_private.cloud_jobs newer WHERE newer.workspace_id=j.workspace_id AND newer.channel_id=j.channel_id AND newer.sender=j.sender AND newer.kind<>'status' AND newer.intake_order>j.intake_order) THEN
    UPDATE workspace_private.cloud_jobs SET state='review',reason='superseded' WHERE id=j.id;CONTINUE;
   END IF;
   UPDATE workspace_private.cloud_jobs SET state='leased',lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=attempts+1 WHERE id=j.id RETURNING * INTO j;
   RETURN workspace_private.cloud_job_snapshot(j);
  END LOOP;
  RETURN NULL;
 END IF;
 SELECT workspace_id INTO w FROM workspace_private.cloud_jobs WHERE id=p_job;
 IF w IS NULL THEN RAISE EXCEPTION 'Job unavailable'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 SELECT * INTO STRICT j FROM workspace_private.cloud_jobs WHERE workspace_id=w AND id=p_job FOR UPDATE;
 IF p_command='finish' AND j.state='done' AND j.lease=p_lease THEN RETURN '{}'::jsonb; END IF;
 IF j.lease IS DISTINCT FROM p_lease OR j.lease_until<=now() OR j.state<>'leased' THEN RAISE EXCEPTION 'Job lease unavailable'; END IF;
 SELECT * INTO STRICT c FROM public.cloud_channels WHERE workspace_id=w AND id=j.channel_id;
 SELECT * INTO STRICT t FROM public.cloud_threads WHERE workspace_id=w AND id=j.thread_id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM public.cloud_drafts WHERE workspace_id=w AND job_id=j.id AND provider='manual' AND approved_at IS NOT NULL AND source_revision=t.revision) INTO manual_approved;
 IF p_command IN ('credential','audio','audio_started','context','reply','draft','dispatch') AND (c.status<>'active' OR (t.human_takeover AND NOT (manual_approved AND p_command IN ('credential','dispatch')))  OR t.revision IS DISTINCT FROM j.thread_revision OR NOT workspace_private.cloud_access(w,'cloud_messaging')) THEN RAISE EXCEPTION 'Cloud access denied' USING ERRCODE='42501'; END IF;
 IF p_command IN ('audio','audio_started','context','reply','draft','dispatch') AND EXISTS(SELECT 1 FROM workspace_private.cloud_jobs newer WHERE newer.workspace_id=w AND newer.channel_id=j.channel_id AND newer.sender=j.sender AND newer.kind<>'status' AND newer.intake_order>j.intake_order) THEN RAISE EXCEPTION 'Newer customer source accepted' USING ERRCODE='40001'; END IF;
 IF p_command='credential' THEN
  RETURN (SELECT jsonb_build_object('sealed',sealed) FROM workspace_private.cloud_credentials WHERE workspace_id=w AND channel_id=c.id AND expires_at>now());
 ELSIF p_command='audio' THEN
  IF j.kind<>'audio' OR j.audio_started_at IS NOT NULL OR NOT workspace_private.cloud_access(w,'voice') THEN RAISE EXCEPTION 'Cloud access denied'; END IF;
  PERFORM workspace_private.reserve_subscription_unit(w,'audio_transcriptions',j.id::text,workspace_private.subscription_limit(w,'audio_transcriptions'));
 ELSIF p_command='audio_started' THEN
  IF j.kind<>'audio' OR j.audio_started_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM workspace_private.subscription_reservations WHERE workspace_id=w AND metric='audio_transcriptions' AND operation_key=j.id::text) THEN RAISE EXCEPTION 'Audio outcome requires review'; END IF;
  UPDATE workspace_private.cloud_jobs SET audio_started_at=clock_timestamp() WHERE id=j.id;
 ELSIF p_command='transcript' THEN
  IF j.kind<>'audio' OR p_payload->>'text' IS NULL OR char_length(p_payload->>'text') NOT BETWEEN 1 AND 4096 OR NOT EXISTS(SELECT 1 FROM workspace_private.subscription_reservations WHERE workspace_id=w AND metric='audio_transcriptions' AND operation_key=j.id::text) THEN RAISE EXCEPTION 'Invalid transcript'; END IF;
  UPDATE public.cloud_messages SET content=p_payload->>'text' WHERE workspace_id=w AND source_job=j.id AND role='customer' AND content IS NULL;
  RETURN workspace_private.cloud_job_snapshot(j);
 ELSIF p_command='context' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ai_agent_settings WHERE workspace_id=w AND enabled) THEN RAISE EXCEPTION 'Agent disabled'; END IF;
  RETURN jsonb_build_object('workspaceId',w,'threadId',t.id,'agent',(SELECT to_jsonb(s)-ARRAY['workspace_id','updated_at'] FROM public.ai_agent_settings s WHERE workspace_id=w),
   'knowledge',jsonb_build_object('products',(SELECT coalesce(jsonb_agg(to_jsonb(p)-ARRAY['workspace_id','created_at','updated_at']),'[]') FROM (SELECT * FROM public.business_products WHERE workspace_id=w ORDER BY id LIMIT 500) p),
   'faqs',(SELECT coalesce(jsonb_agg(to_jsonb(f)-ARRAY['workspace_id','created_at','updated_at']),'[]') FROM (SELECT * FROM public.business_faqs WHERE workspace_id=w ORDER BY id LIMIT 200) f),
   'information',(SELECT coalesce(jsonb_agg(to_jsonb(i)-ARRAY['workspace_id','created_at','updated_at']),'[]') FROM (SELECT * FROM public.business_information WHERE workspace_id=w ORDER BY id LIMIT 5) i)),
   'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('role','user','content',m.content) ORDER BY m.intake_order),'[]') FROM
    (SELECT m.content,source.intake_order FROM public.cloud_messages m JOIN workspace_private.cloud_jobs source ON source.workspace_id=m.workspace_id AND source.id=m.source_job WHERE m.workspace_id=w AND m.thread_id=t.id AND m.role='customer' AND m.source_job<>j.id AND m.content IS NOT NULL ORDER BY source.intake_order DESC LIMIT 12) m));
 ELSIF p_command='reply' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ai_agent_settings WHERE workspace_id=w AND enabled) OR (c.mode='automatic' AND NOT workspace_private.cloud_access(w,'automation')) THEN RAISE EXCEPTION 'Cloud access denied'; END IF;
  fresh:=workspace_private.reserve_subscription_unit(w,'ai_generations','cloud:'||j.id::text,workspace_private.subscription_limit(w,'ai_generations'));
  IF NOT fresh THEN RAISE EXCEPTION 'AI reservation already used'; END IF;
  SELECT user_id INTO STRICT owner_id FROM public.workspace_members WHERE workspace_id=w AND role='owner';
  INSERT INTO workspace_private.ai_preview_usage AS q(user_id,used_on,used) VALUES(owner_id,(now() AT TIME ZONE 'UTC')::date,1)
   ON CONFLICT(user_id,used_on) DO UPDATE SET used=q.used+1 WHERE q.used<50 RETURNING used INTO daily;
  IF daily IS NULL THEN RAISE EXCEPTION 'Daily AI limit reached' USING ERRCODE='54000'; END IF;
  FOR period_name,period_max IN SELECT * FROM (VALUES('minute',6),('day',100)) limits(period,maximum) LOOP
   window_used:=NULL;
   INSERT INTO workspace_private.whatsapp_inbox_usage AS q(user_id,period,bucket,used) VALUES(owner_id,period_name,date_trunc(period_name,now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',1)
    ON CONFLICT(user_id,period,bucket) DO UPDATE SET used=q.used+1 WHERE q.used<period_max RETURNING used INTO window_used;
   IF window_used IS NULL THEN RAISE EXCEPTION 'WhatsApp generation rate reached' USING ERRCODE='54000'; END IF;
  END LOOP;
 ELSIF p_command='draft' THEN
  IF NOT EXISTS(SELECT 1 FROM workspace_private.subscription_reservations WHERE workspace_id=w AND metric='ai_generations' AND operation_key='cloud:'||j.id::text) THEN RAISE EXCEPTION 'Missing AI reservation'; END IF;
  INSERT INTO public.cloud_drafts(workspace_id,thread_id,job_id,source_revision,content) VALUES(w,t.id,j.id,j.thread_revision,p_payload->>'text') RETURNING * INTO d;
  RETURN jsonb_build_object('id',d.id);
 ELSIF p_command='dispatch' THEN
  SELECT * INTO STRICT d FROM public.cloud_drafts WHERE workspace_id=w AND thread_id=t.id AND job_id=j.id AND id=(p_payload->>'draftId')::uuid;
  IF d.source_revision<>t.revision OR (c.mode='review' AND d.approved_at IS NULL) OR (c.mode='automatic' AND NOT workspace_private.cloud_access(w,'automation')) OR t.last_customer_at<=now()-interval '24 hours' THEN RAISE EXCEPTION 'Dispatch blocked'; END IF;
  IF EXISTS(SELECT 1 FROM workspace_private.cloud_attempts WHERE draft_id=d.id AND (status<>'rejected' OR NOT retryable OR retry_after>now())) OR (SELECT count(*) FROM workspace_private.cloud_attempts WHERE draft_id=d.id)>=3 THEN RAISE EXCEPTION 'Dispatch already attempted or unavailable'; END IF;
  INSERT INTO workspace_private.cloud_attempts(workspace_id,draft_id,content) VALUES(w,d.id,d.content) RETURNING * INTO a;
  RETURN jsonb_build_object('attemptId',a.id,'text',d.content,'recipient',t.customer_id,'phoneId',c.phone_id);
 ELSIF p_command IN ('sent','uncertain','rejected') THEN
  SELECT attempts.* INTO STRICT a FROM workspace_private.cloud_attempts attempts JOIN public.cloud_drafts draft ON draft.id=attempts.draft_id AND draft.workspace_id=attempts.workspace_id
   WHERE attempts.workspace_id=w AND attempts.id=(p_payload->>'attemptId')::uuid AND draft.job_id=j.id FOR UPDATE OF attempts;
  IF a.status NOT IN ('dispatching','unknown') THEN RETURN '{}'::jsonb; END IF;
  IF p_command='sent' THEN
   UPDATE workspace_private.cloud_attempts SET status='accepted',provider_id=p_payload->>'providerId',updated_at=now() WHERE id=a.id;
   UPDATE workspace_private.cloud_jobs SET reason=NULL WHERE id=j.id;
  ELSIF p_command='uncertain' THEN
   UPDATE workspace_private.cloud_attempts SET status='unknown',updated_at=now() WHERE id=a.id;
   UPDATE workspace_private.cloud_jobs SET state='delivery_pending',reason='provider_reconciliation' WHERE id=j.id;
   UPDATE public.cloud_threads SET human_takeover=true,revision=revision+1 WHERE id=t.id;
  ELSE
   UPDATE workspace_private.cloud_attempts SET status='rejected',retryable=coalesce((p_payload->>'retryable')::boolean,false),retry_after=now()+least(900,greatest(1,coalesce((p_payload->>'seconds')::integer,60)))*interval '1 second',updated_at=now() WHERE id=a.id;
   UPDATE workspace_private.cloud_jobs SET state=CASE WHEN coalesce((p_payload->>'retryable')::boolean,false) AND attempts<5 THEN 'deferred' ELSE 'review' END,available_at=now()+interval '15 minutes',reason='provider_rejected' WHERE id=j.id;
  END IF;
 ELSIF p_command='handoff' THEN
  UPDATE public.cloud_threads SET human_takeover=true,revision=revision+1 WHERE workspace_id=w AND id=t.id;
  INSERT INTO workspace_private.cloud_audit(workspace_id,event,object_id) VALUES(w,'takeover',t.id);
  UPDATE workspace_private.cloud_jobs SET reason=CASE WHEN p_payload->>'reason' IN ('audio_review','unsupported','requested','window_closed') THEN p_payload->>'reason' ELSE 'review' END WHERE id=j.id;
 ELSIF p_command='finish' THEN
  UPDATE workspace_private.cloud_jobs SET state='done' WHERE id=j.id;
 ELSIF p_command='defer' THEN
  IF j.attempts>=5 THEN UPDATE public.cloud_threads SET human_takeover=true,revision=revision+1 WHERE workspace_id=w AND id=t.id; END IF;
  UPDATE workspace_private.cloud_jobs SET state=CASE WHEN attempts>=5 THEN 'review' ELSE 'deferred' END,available_at=now()+interval '5 minutes',reason=CASE WHEN p_payload->>'reason'='access' THEN 'access' ELSE 'processing' END WHERE id=j.id;
 ELSE RAISE EXCEPTION 'Invalid worker command'; END IF;
 RETURN '{}'::jsonb;
END$$;

CREATE FUNCTION public.manage_cloud(p_workspace_id uuid,p_object_id uuid,p_revision integer,p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.cloud_channels%ROWTYPE;t public.cloud_threads%ROWTYPE;d public.cloud_drafts%ROWTYPE;latest_job uuid;
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF p_action IN ('disable','review','automatic') THEN
  SELECT * INTO STRICT c FROM public.cloud_channels WHERE workspace_id=p_workspace_id AND id=p_object_id FOR UPDATE;
  IF c.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Stale channel' USING ERRCODE='40001'; END IF;
  IF p_action='automatic' AND (c.status<>'active' OR NOT workspace_private.cloud_access(p_workspace_id,'cloud_messaging') OR NOT workspace_private.cloud_access(p_workspace_id,'automation')) THEN RAISE EXCEPTION 'Automation unavailable'; END IF;
  UPDATE public.cloud_channels SET status=CASE WHEN p_action='disable' THEN 'disabled' ELSE status END,mode=CASE WHEN p_action='automatic' THEN 'automatic' ELSE 'review' END,revision=revision+1 WHERE id=c.id;
  IF p_action='disable' THEN UPDATE public.cloud_threads SET human_takeover=true,revision=revision+1 WHERE workspace_id=p_workspace_id AND channel_id=c.id; END IF;
 ELSIF p_action IN ('takeover','release') THEN
  SELECT * INTO STRICT t FROM public.cloud_threads WHERE workspace_id=p_workspace_id AND id=p_object_id FOR UPDATE;
  IF t.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Stale thread' USING ERRCODE='40001'; END IF;
  IF p_action='release' AND EXISTS(SELECT 1 FROM workspace_private.cloud_attempts a JOIN public.cloud_drafts pending_draft ON pending_draft.workspace_id=a.workspace_id AND pending_draft.id=a.draft_id WHERE pending_draft.workspace_id=p_workspace_id AND pending_draft.thread_id=t.id AND a.status IN ('unknown','dispatching')) THEN RAISE EXCEPTION 'Delivery reconciliation required'; END IF;
  UPDATE public.cloud_threads SET human_takeover=p_action='takeover',revision=revision+1 WHERE id=t.id RETURNING * INTO t;
  IF p_action='release' THEN
   SELECT id INTO latest_job FROM workspace_private.cloud_jobs WHERE workspace_id=p_workspace_id AND thread_id=t.id AND kind IN ('text','audio') ORDER BY intake_order DESC LIMIT 1;
   UPDATE workspace_private.cloud_jobs SET state='done',reason='human_reviewed' WHERE workspace_id=p_workspace_id AND thread_id=t.id AND id<>latest_job AND state IN ('review','deferred');
   UPDATE workspace_private.cloud_jobs j SET state='queued',available_at=now(),attempts=0,thread_revision=t.revision WHERE j.workspace_id=p_workspace_id AND j.id=latest_job AND j.state IN ('review','deferred')
    AND NOT EXISTS(SELECT 1 FROM workspace_private.subscription_reservations WHERE workspace_id=p_workspace_id AND metric='ai_generations' AND operation_key='cloud:'||j.id::text)
    AND (j.audio_started_at IS NULL OR EXISTS(SELECT 1 FROM public.cloud_messages WHERE workspace_id=p_workspace_id AND source_job=j.id AND role='customer' AND content IS NOT NULL));
  END IF;
 ELSIF p_action IN ('approve','retry') THEN
  SELECT * INTO STRICT d FROM public.cloud_drafts WHERE workspace_id=p_workspace_id AND id=p_object_id FOR UPDATE;
  SELECT * INTO STRICT t FROM public.cloud_threads WHERE workspace_id=p_workspace_id AND id=d.thread_id FOR UPDATE;
  IF d.revision IS DISTINCT FROM p_revision OR d.source_revision<>t.revision OR (t.human_takeover AND d.provider<>'manual') OR NOT workspace_private.cloud_access(p_workspace_id,'cloud_messaging') OR t.last_customer_at<=now()-interval '24 hours' OR (p_action='approve' AND EXISTS(SELECT 1 FROM workspace_private.cloud_attempts WHERE draft_id=d.id)) OR (p_action='retry' AND (NOT EXISTS(SELECT 1 FROM workspace_private.cloud_attempts WHERE draft_id=d.id) OR EXISTS(SELECT 1 FROM workspace_private.cloud_attempts WHERE draft_id=d.id AND status<>'rejected') OR (SELECT count(*) FROM workspace_private.cloud_attempts WHERE draft_id=d.id)>=3)) THEN RAISE EXCEPTION 'Draft stale or already attempted' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM workspace_private.cloud_jobs source JOIN workspace_private.cloud_jobs newer ON newer.workspace_id=source.workspace_id AND newer.channel_id=source.channel_id AND newer.sender=source.sender AND newer.kind<>'status' AND newer.intake_order>source.intake_order WHERE source.id=d.job_id AND source.workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'Newer customer source accepted' USING ERRCODE='40001'; END IF;
  IF p_action='retry' THEN UPDATE workspace_private.cloud_attempts SET retryable=true,retry_after=now() WHERE draft_id=d.id AND status='rejected'; END IF;
  UPDATE public.cloud_drafts SET approved_by=auth.uid(),approved_at=now(),revision=revision+1 WHERE id=d.id;
  UPDATE workspace_private.cloud_jobs SET state='queued',available_at=now(),thread_revision=t.revision,attempts=0 WHERE workspace_id=p_workspace_id AND id=d.job_id;
 ELSE RAISE EXCEPTION 'Unknown management action'; END IF;
 INSERT INTO workspace_private.cloud_audit(workspace_id,actor_id,event,object_id) VALUES(p_workspace_id,auth.uid(),CASE WHEN p_action IN ('approve','retry') THEN 'approved' WHEN p_action='disable' THEN 'disabled' WHEN p_action IN ('takeover','release') THEN 'takeover' ELSE 'mode' END,p_object_id);
END$$;
CREATE FUNCTION public.save_cloud_manual_draft(p_workspace_id uuid,p_thread_id uuid,p_revision integer,p_content text,p_draft_revision integer DEFAULT NULL,p_expected_source uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.cloud_threads%ROWTYPE;j workspace_private.cloud_jobs%ROWTYPE;d public.cloud_drafts%ROWTYPE;
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 SELECT * INTO STRICT t FROM public.cloud_threads WHERE workspace_id=p_workspace_id AND id=p_thread_id FOR UPDATE;
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) OR NOT workspace_private.cloud_access(p_workspace_id,'cloud_messaging') OR NOT workspace_private.cloud_access(p_workspace_id,'manual_inbox') OR t.revision IS DISTINCT FROM p_revision OR char_length(btrim(p_content)) NOT BETWEEN 1 AND 4096 THEN RAISE EXCEPTION 'Manual draft unavailable'; END IF;
 SELECT * INTO STRICT j FROM workspace_private.cloud_jobs WHERE workspace_id=p_workspace_id AND thread_id=t.id AND kind IN ('text','audio') ORDER BY intake_order DESC LIMIT 1 FOR UPDATE;
 IF p_expected_source IS NULL OR j.id IS DISTINCT FROM p_expected_source OR EXISTS(SELECT 1 FROM workspace_private.cloud_jobs newer WHERE newer.workspace_id=p_workspace_id AND newer.channel_id=j.channel_id AND newer.sender=j.sender AND newer.kind<>'status' AND newer.intake_order>j.intake_order) THEN RAISE EXCEPTION 'Customer source changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO d FROM public.cloud_drafts WHERE workspace_id=p_workspace_id AND job_id=j.id FOR UPDATE;
 IF FOUND THEN
  IF d.revision IS DISTINCT FROM p_draft_revision OR EXISTS(SELECT 1 FROM workspace_private.cloud_attempts WHERE draft_id=d.id) THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
  UPDATE public.cloud_drafts SET content=p_content,provider='manual',source_revision=t.revision,revision=revision+1,approved_by=NULL,approved_at=NULL WHERE id=d.id;
 ELSE
  IF p_draft_revision IS NOT NULL THEN RAISE EXCEPTION 'Draft unavailable'; END IF;
  INSERT INTO public.cloud_drafts(workspace_id,thread_id,job_id,source_revision,content,provider) VALUES(p_workspace_id,t.id,j.id,t.revision,p_content,'manual') RETURNING * INTO d;
 END IF;
 RETURN d.id;
END$$;
CREATE FUNCTION public.get_cloud_workspace(p_workspace_id uuid,p_thread_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF p_thread_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cloud_threads WHERE workspace_id=p_workspace_id AND id=p_thread_id) THEN RAISE EXCEPTION 'Thread unavailable'; END IF;
 RETURN jsonb_build_object('workspaceId',p_workspace_id,'channels',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.cloud_channels c WHERE workspace_id=p_workspace_id),
 'threads',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM (SELECT id,channel_id,right(customer_id,4) AS customer_suffix,human_takeover,revision,last_customer_at FROM public.cloud_threads WHERE workspace_id=p_workspace_id ORDER BY last_customer_at DESC,id LIMIT 25) t),
 'messages',(SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM (SELECT id,source_job,role,kind,content,created_at FROM public.cloud_messages WHERE workspace_id=p_workspace_id AND thread_id=p_thread_id ORDER BY created_at DESC,id DESC LIMIT 50) m),
 'drafts',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM (SELECT id,job_id,revision,source_revision,content,provider,approved_at FROM public.cloud_drafts WHERE workspace_id=p_workspace_id AND thread_id=p_thread_id ORDER BY created_at DESC LIMIT 50) d),
 'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM (SELECT attempt.id,attempt.draft_id,attempt.status,attempt.created_at FROM workspace_private.cloud_attempts attempt JOIN public.cloud_drafts draft ON draft.workspace_id=attempt.workspace_id AND draft.id=attempt.draft_id WHERE draft.workspace_id=p_workspace_id AND draft.thread_id=p_thread_id ORDER BY attempt.created_at DESC LIMIT 50) a));
END$$;

CREATE TABLE workspace_private.workspace_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.workspaces(id),email text NOT NULL CHECK(char_length(email) BETWEEN 3 AND 254 AND email=lower(email)),
 token_hash bytea NOT NULL UNIQUE,created_by uuid NOT NULL REFERENCES auth.users(id),expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),accepted_by uuid REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workspace_private.workspace_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_private.workspace_invitations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_workspace_invitation(p_workspace_id uuid,p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token text;invitation uuid;email text:=lower(btrim(p_email));
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) OR NOT EXISTS(SELECT 1 FROM public.workspace_subscriptions WHERE workspace_id=p_workspace_id AND workspace_private.subscription_access(workspace_subscriptions) IS TRUE) THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
 IF email IS NULL OR char_length(email)>254 OR email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid email'; END IF;
 IF (SELECT count(*) FROM workspace_private.workspace_invitations WHERE workspace_id=p_workspace_id AND status='pending' AND expires_at>now())>=10 THEN RAISE EXCEPTION 'Invitation capacity reached' USING ERRCODE='54000'; END IF;
 IF (SELECT count(*) FROM public.workspace_members WHERE workspace_id=p_workspace_id)>=workspace_private.subscription_limit(p_workspace_id,'members') THEN RAISE EXCEPTION 'Team capacity reached' USING ERRCODE='54000'; END IF;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 INSERT INTO workspace_private.workspace_invitations(workspace_id,email,token_hash,created_by) VALUES(p_workspace_id,email,sha256(convert_to(token,'UTF8')),auth.uid()) RETURNING id INTO invitation;
 INSERT INTO workspace_private.cloud_audit(workspace_id,actor_id,event,object_id) VALUES(p_workspace_id,auth.uid(),'invited',invitation);
 RETURN jsonb_build_object('id',invitation,'token',token,'expiresIn',604800);
END$$;
CREATE FUNCTION public.accept_workspace_invitation(p_token text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invitation workspace_private.workspace_invitations%ROWTYPE;w uuid;verified_email text;
BEGIN
 IF auth.uid() IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR p_token IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 SELECT lower(email) INTO verified_email FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
 SELECT workspace_id INTO w FROM workspace_private.workspace_invitations WHERE token_hash=sha256(convert_to(p_token,'UTF8'));
 IF w IS NULL OR verified_email IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 SELECT * INTO STRICT invitation FROM workspace_private.workspace_invitations WHERE workspace_id=w AND token_hash=sha256(convert_to(p_token,'UTF8')) FOR UPDATE;
 IF invitation.status='accepted' AND invitation.accepted_by=auth.uid() AND invitation.email=verified_email AND EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=auth.uid()) THEN RETURN w::text; END IF;
 IF invitation.status<>'pending' OR invitation.expires_at<=now() OR invitation.email IS DISTINCT FROM verified_email THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 -- Existing Phase 8 membership trigger enforces current subscription/capacity.
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,auth.uid(),'member') ON CONFLICT(workspace_id,user_id) DO NOTHING;
 UPDATE workspace_private.workspace_invitations SET status='accepted',accepted_by=auth.uid() WHERE id=invitation.id;
 INSERT INTO workspace_private.cloud_audit(workspace_id,actor_id,event,object_id) VALUES(w,auth.uid(),'joined',invitation.id);
 RETURN w::text;
END$$;
CREATE FUNCTION public.revoke_workspace_invitation(p_workspace_id uuid,p_invitation_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 UPDATE workspace_private.workspace_invitations SET status='revoked' WHERE workspace_id=p_workspace_id AND id=p_invitation_id AND status='pending';
 INSERT INTO workspace_private.cloud_audit(workspace_id,actor_id,event,object_id) VALUES(p_workspace_id,auth.uid(),'invite_revoked',p_invitation_id);
END$$;
CREATE FUNCTION public.get_workspace_invitations(p_workspace_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM (SELECT id,email,status,expires_at FROM workspace_private.workspace_invitations WHERE workspace_id=p_workspace_id ORDER BY created_at DESC LIMIT 50) i);
END$$;


CREATE FUNCTION public.get_workspace_team(p_workspace_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'email',nullif(u.email,'')) ORDER BY m.created_at,m.user_id),'[]') FROM public.workspace_members m JOIN auth.users u ON u.id=m.user_id WHERE m.workspace_id=p_workspace_id);
END$$;
CREATE FUNCTION public.remove_workspace_member(p_workspace_id uuid,p_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_user_id AND role<>'owner') THEN RAISE EXCEPTION 'Member unavailable' USING ERRCODE='42501'; END IF;
 UPDATE public.whatsapp_inbox_state SET assigned_user_id=NULL,human_takeover=true,status=CASE WHEN status='closed' THEN status ELSE 'pending_human' END,revision=revision+1,updated_at=now() WHERE workspace_id=p_workspace_id AND assigned_user_id=p_user_id;
 UPDATE workspace_private.workspace_invitations i SET status='revoked' WHERE i.workspace_id=p_workspace_id AND i.status='pending' AND
  (i.email=(SELECT lower(email) FROM auth.users WHERE id=p_user_id) OR i.email IN(SELECT email FROM workspace_private.workspace_invitations WHERE workspace_id=p_workspace_id AND accepted_by=p_user_id));
 DELETE FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_user_id AND role<>'owner';
 INSERT INTO workspace_private.cloud_audit(workspace_id,actor_id,event,object_id) VALUES(p_workspace_id,auth.uid(),'member_removed',p_user_id);
END$$;

CREATE TABLE workspace_private.subscription_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.workspaces(id),plan_id text NOT NULL REFERENCES public.wasla_subscription_plans(id),action text NOT NULL DEFAULT 'change' CHECK(action IN ('change','cancel','renewal')),
 requested_by uuid NOT NULL REFERENCES auth.users(id),subscription_revision integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','withdrawn','rejected','approved_pending_activation')),created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,review_reason text
);
CREATE UNIQUE INDEX subscription_one_pending_request ON workspace_private.subscription_requests(workspace_id) WHERE status='pending';
ALTER TABLE workspace_private.subscription_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_private.subscription_requests FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.request_subscription_review(p_workspace_id uuid,p_plan_id text,p_action text DEFAULT 'change') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision integer;request_id uuid;chosen_plan text;
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) OR p_action IS NULL OR p_action NOT IN ('change','cancel','renewal') OR (p_action='change' AND (p_plan_id NOT IN ('starter','pro','business') OR p_plan_id IS NULL)) THEN RAISE EXCEPTION 'Request unavailable'; END IF;
 SELECT s.revision,CASE WHEN p_action='change' THEN p_plan_id ELSE s.plan_id END INTO STRICT revision,chosen_plan FROM public.workspace_subscriptions s WHERE workspace_id=p_workspace_id;
 INSERT INTO workspace_private.subscription_requests(workspace_id,plan_id,action,requested_by,subscription_revision) VALUES(p_workspace_id,chosen_plan,p_action,auth.uid(),revision) RETURNING id INTO request_id;
 INSERT INTO workspace_private.cloud_audit(workspace_id,actor_id,event,object_id) VALUES(p_workspace_id,auth.uid(),'plan_requested',request_id);
 RETURN request_id;
END$$;
CREATE FUNCTION public.get_subscription_requests(p_workspace_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM (SELECT id,plan_id,action,status,created_at,reviewed_at FROM workspace_private.subscription_requests WHERE workspace_id=p_workspace_id ORDER BY created_at DESC LIMIT 20) r);
END$$;

CREATE FUNCTION public.withdraw_subscription_request(p_workspace_id uuid,p_request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 UPDATE workspace_private.subscription_requests SET status='withdrawn',reviewed_at=now() WHERE workspace_id=p_workspace_id AND id=p_request_id AND status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable'; END IF;
 INSERT INTO workspace_private.cloud_audit(workspace_id,actor_id,event,object_id) VALUES(p_workspace_id,auth.uid(),'plan_withdrawn',p_request_id);
END$$;

CREATE FUNCTION workspace_private.review_subscription_request(p_id uuid,p_expected_revision integer,p_approve boolean,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r workspace_private.subscription_requests%ROWTYPE;w uuid;
BEGIN
 SELECT workspace_id INTO STRICT w FROM workspace_private.subscription_requests WHERE id=p_id;
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 SELECT * INTO STRICT r FROM workspace_private.subscription_requests WHERE workspace_id=w AND id=p_id FOR UPDATE;
 IF r.status<>'pending' OR r.subscription_revision IS DISTINCT FROM p_expected_revision OR NOT EXISTS(SELECT 1 FROM public.workspace_subscriptions WHERE workspace_id=w AND revision=p_expected_revision) OR p_approve IS NULL OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Review stale or invalid'; END IF;
 UPDATE workspace_private.subscription_requests SET status=CASE WHEN p_approve THEN 'approved_pending_activation' ELSE 'rejected' END,reviewed_at=now(),review_reason=p_reason WHERE id=p_id;
 INSERT INTO workspace_private.cloud_audit(workspace_id,actor_id,event,object_id) VALUES(w,auth.uid(),'plan_reviewed',p_id);
 -- Approval is an audited review state ONLY. Never mutate subscription/payment.
END$$;



CREATE FUNCTION workspace_private.review_cloud_attempt(p_attempt uuid,p_outcome text,p_provider_id text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a workspace_private.cloud_attempts%ROWTYPE;d public.cloud_drafts%ROWTYPE;w uuid;
BEGIN
 SELECT workspace_id INTO STRICT w FROM workspace_private.cloud_attempts WHERE id=p_attempt;
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 SELECT * INTO STRICT a FROM workspace_private.cloud_attempts WHERE workspace_id=w AND id=p_attempt FOR UPDATE;
 SELECT * INTO STRICT d FROM public.cloud_drafts WHERE workspace_id=w AND id=a.draft_id;
 IF a.status NOT IN ('unknown','dispatching') OR p_outcome IS NULL OR p_outcome NOT IN ('not_accepted','sent_proven') OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Review unavailable'; END IF;
 IF p_outcome='sent_proven' THEN
  IF p_provider_id IS NULL OR char_length(p_provider_id) NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'Provider evidence required'; END IF;
  UPDATE workspace_private.cloud_attempts SET status='sent',provider_id=p_provider_id,retryable=false,updated_at=now() WHERE id=a.id;
  INSERT INTO public.cloud_messages(workspace_id,thread_id,source_job,role,kind,content) VALUES(w,d.thread_id,d.job_id,'assistant','text',a.content) ON CONFLICT(source_job,role) DO NOTHING;
  UPDATE workspace_private.cloud_jobs SET state='done',reason='operator_reconciled' WHERE workspace_id=w AND id=d.job_id;
 ELSE
  UPDATE workspace_private.cloud_attempts SET status='rejected',retryable=false,updated_at=now() WHERE id=a.id;
  UPDATE workspace_private.cloud_jobs SET state='review',reason='operator_reconciled' WHERE workspace_id=w AND id=d.job_id;
 END IF;
 INSERT INTO workspace_private.cloud_audit(workspace_id,event,object_id) VALUES(w,'delivery_reviewed',a.id);
 -- p_reason is required for the trusted operator's evidence ledger; store only
 -- bounded audit reason below, never credentials or full provider payloads.
 UPDATE workspace_private.cloud_jobs SET reason='operator_review:'||left(p_reason,400) WHERE workspace_id=w AND id=d.job_id;
END$$;

CREATE FUNCTION public.rotate_cloud_credential(p_job uuid,p_lease uuid,p_old jsonb,p_new jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j workspace_private.cloud_jobs%ROWTYPE;w uuid;
BEGIN
 SELECT workspace_id INTO STRICT w FROM workspace_private.cloud_jobs WHERE id=p_job;
 PERFORM 1 FROM public.workspaces WHERE id=w FOR UPDATE;
 SELECT * INTO STRICT j FROM workspace_private.cloud_jobs WHERE workspace_id=w AND id=p_job FOR UPDATE;
 IF j.state<>'leased' OR j.lease IS DISTINCT FROM p_lease OR j.lease_until<=now() OR p_new->>'version'<>'1' OR char_length(p_new->>'ciphertext')>12000 OR p_new->>'keyId' IS NULL OR p_new->>'keyId'=p_old->>'keyId' THEN RAISE EXCEPTION 'Credential rotation unavailable'; END IF;
 UPDATE workspace_private.cloud_credentials SET sealed=p_new WHERE workspace_id=w AND channel_id=j.channel_id AND sealed=p_old AND expires_at>now();
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO workspace_private.cloud_audit(workspace_id,event,object_id) VALUES(w,'credential_rotated',j.channel_id);
 RETURN true;
END$$;


CREATE TABLE workspace_private.cloud_media_reads(workspace_id uuid NOT NULL REFERENCES public.workspaces(id),bucket timestamptz NOT NULL,used integer NOT NULL CHECK(used BETWEEN 1 AND 20),PRIMARY KEY(workspace_id,bucket));
ALTER TABLE workspace_private.cloud_media_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_private.cloud_media_reads FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.cloud_audio_for_owner(p_workspace_id uuid,p_actor_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j workspace_private.cloud_jobs%ROWTYPE;used_count integer;
BEGIN
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role='owner') THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 SELECT source.* INTO STRICT j FROM public.cloud_messages m JOIN workspace_private.cloud_jobs source ON source.id=m.source_job AND source.workspace_id=m.workspace_id AND source.thread_id=m.thread_id
 WHERE m.workspace_id=p_workspace_id AND m.id=p_message_id AND m.role='customer' AND m.kind='audio';
 DELETE FROM workspace_private.cloud_media_reads WHERE workspace_id=p_workspace_id AND bucket<now()-interval '2 days';
 INSERT INTO workspace_private.cloud_media_reads AS q(workspace_id,bucket,used) VALUES(p_workspace_id,date_trunc('minute',now()),1)
 ON CONFLICT(workspace_id,bucket) DO UPDATE SET used=q.used+1 WHERE q.used<20 RETURNING used INTO used_count;
 IF used_count IS NULL THEN RAISE EXCEPTION 'Media rate limit reached' USING ERRCODE='54000'; END IF;
 RETURN (SELECT jsonb_build_object('workspaceId',p_workspace_id,'channelId',c.id,'phoneId',c.phone_id,'mediaId',j.payload->'audio'->>'id','hash',j.payload->'audio'->>'sha256','sealed',credential.sealed)
 FROM public.cloud_channels c JOIN workspace_private.cloud_credentials credential ON credential.workspace_id=c.workspace_id AND credential.channel_id=c.id
 WHERE c.workspace_id=p_workspace_id AND c.id=j.channel_id AND c.status='active' AND credential.expires_at>now());
END$$;

-- Explicit ACLs override permissive Supabase defaults, including sequences and
-- PostgreSQL's default PUBLIC EXECUTE on definer functions.
REVOKE ALL ON SEQUENCE workspace_private.cloud_jobs_intake_order_seq FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE p record;BEGIN
 FOR p IN SELECT n.nspname,proc.oid::regprocedure AS signature FROM pg_proc proc JOIN pg_namespace n ON n.oid=proc.pronamespace
 WHERE (n.nspname='public' AND proc.proname IN ('begin_cloud_signup','cloud_signup_control','accept_cloud_event','cloud_worker','manage_cloud','save_cloud_manual_draft','get_cloud_workspace','create_workspace_invitation','accept_workspace_invitation','revoke_workspace_invitation','get_workspace_invitations','request_subscription_review','get_subscription_requests','withdraw_subscription_request','get_workspace_team','remove_workspace_member','cloud_audio_for_owner','rotate_cloud_credential'))
 OR (n.nspname='workspace_private' AND proc.proname IN ('cloud_access','cloud_number_capacity','apply_cloud_status','cloud_job_snapshot','review_subscription_request','review_cloud_attempt'))
 LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',p.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',p.signature);
 END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION public.get_workspace_team(uuid),public.remove_workspace_member(uuid,uuid),public.begin_cloud_signup(uuid,uuid),public.manage_cloud(uuid,uuid,integer,text),public.save_cloud_manual_draft(uuid,uuid,integer,text,integer,uuid),public.get_cloud_workspace(uuid,uuid),public.create_workspace_invitation(uuid,text),public.accept_workspace_invitation(text),public.revoke_workspace_invitation(uuid,uuid),public.get_workspace_invitations(uuid),public.request_subscription_review(uuid,text,text),public.withdraw_subscription_request(uuid,uuid),public.get_subscription_requests(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_audio_for_owner(uuid,uuid,uuid),public.rotate_cloud_credential(uuid,uuid,jsonb,jsonb),public.cloud_signup_control(text,jsonb),public.accept_cloud_event(jsonb),public.cloud_worker(text,uuid,uuid,jsonb) TO service_role;
COMMIT;

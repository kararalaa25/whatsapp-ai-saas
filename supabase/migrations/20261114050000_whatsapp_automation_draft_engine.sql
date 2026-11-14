-- UNAPPLIED Phase 7B. Apply after 20261114040000 (also UNAPPLIED).
-- No outbound table, queue, worker, credentials, extension or network operation.
BEGIN;
CREATE TABLE public.whatsapp_automation_settings (
    workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id),
    mode text NOT NULL DEFAULT 'disabled' CHECK (mode IN ('disabled','draft_only')),
    language text NOT NULL DEFAULT 'auto' CHECK (language IN ('auto','ar','en')),
    business_rules text NOT NULL DEFAULT '' CHECK (char_length(business_rules) <= 2000),
    working_hours_enabled boolean NOT NULL DEFAULT false,
    timezone text NOT NULL DEFAULT 'Asia/Baghdad' CHECK (char_length(timezone) BETWEEN 1 AND 100),
    working_days integer[] NOT NULL DEFAULT ARRAY[0,1,2,3,4]
        CHECK (cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ ARRAY[0,1,2,3,4,5,6] AND array_position(working_days,NULL) IS NULL),
    start_minute integer NOT NULL DEFAULT 540 CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute integer NOT NULL DEFAULT 1020 CHECK (end_minute BETWEEN 1 AND 1440 AND end_minute > start_minute),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_by uuid REFERENCES auth.users(id),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.whatsapp_automation_runs (
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    source_message_id uuid NOT NULL,
    source_position integer NOT NULL CHECK (source_position > 0),
    token uuid NOT NULL DEFAULT gen_random_uuid(),
    status text NOT NULL CHECK (status IN ('generating','draft','pending_human')),
    attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 3),
    conversation_revision integer NOT NULL,
    state_revision integer NOT NULL,
    settings_revision integer NOT NULL,
    agent_snapshot jsonb,
    draft_id uuid,
    created_by uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, source_message_id),
    UNIQUE (token),
    FOREIGN KEY (workspace_id, conversation_id) REFERENCES public.ai_conversations(workspace_id,id),
    FOREIGN KEY (workspace_id, connection_id) REFERENCES public.whatsapp_connections(workspace_id,id),
    FOREIGN KEY (workspace_id, source_message_id) REFERENCES public.whatsapp_inbound_messages(workspace_id,id),
    FOREIGN KEY (workspace_id, draft_id) REFERENCES public.whatsapp_reply_drafts(workspace_id,id),
    CHECK ((status = 'draft') = (draft_id IS NOT NULL))
);
CREATE INDEX whatsapp_automation_runs_conversation ON public.whatsapp_automation_runs(workspace_id,conversation_id,created_at DESC);
CREATE INDEX whatsapp_automation_runs_connection ON public.whatsapp_automation_runs(workspace_id,connection_id);
CREATE INDEX whatsapp_automation_runs_draft ON public.whatsapp_automation_runs(workspace_id,draft_id);
CREATE TABLE public.whatsapp_automation_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
    actor_id uuid NOT NULL REFERENCES auth.users(id),
    event text NOT NULL CHECK (event IN ('settings_updated','reserved','retried','draft_created','pending_human')),
    source_message_id uuid,
    settings_revision integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id,source_message_id) REFERENCES public.whatsapp_inbound_messages(workspace_id,id)
);
CREATE INDEX whatsapp_automation_audit_workspace ON public.whatsapp_automation_audit(workspace_id,created_at DESC,id DESC);
CREATE INDEX whatsapp_automation_audit_source ON public.whatsapp_automation_audit(workspace_id,source_message_id);
ALTER TABLE public.whatsapp_automation_settings OWNER TO postgres;
ALTER TABLE public.whatsapp_automation_runs OWNER TO postgres;
ALTER TABLE public.whatsapp_automation_audit OWNER TO postgres;
ALTER TABLE public.whatsapp_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_automation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_automation_settings,public.whatsapp_automation_runs,public.whatsapp_automation_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.whatsapp_automation_settings,public.whatsapp_automation_runs,public.whatsapp_automation_audit TO authenticated;
CREATE POLICY automation_settings_owner ON public.whatsapp_automation_settings FOR SELECT TO authenticated USING (workspace_private.is_workspace_owner(workspace_id));
CREATE POLICY automation_runs_owner ON public.whatsapp_automation_runs FOR SELECT TO authenticated USING (workspace_private.is_workspace_owner(workspace_id));
CREATE POLICY automation_audit_owner ON public.whatsapp_automation_audit FOR SELECT TO authenticated USING (workspace_private.is_workspace_owner(workspace_id));

INSERT INTO public.whatsapp_automation_settings(workspace_id) SELECT id FROM public.workspaces;
CREATE FUNCTION workspace_private.initialize_whatsapp_automation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
    INSERT INTO public.whatsapp_automation_settings(workspace_id) VALUES (NEW.id);
    RETURN NEW;
END;
$function$;
CREATE TRIGGER initialize_whatsapp_automation AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION workspace_private.initialize_whatsapp_automation();

CREATE FUNCTION public.save_whatsapp_automation_settings(p_workspace_id uuid,p_revision integer,p_settings jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_revision integer; v_days integer[];
BEGIN
    IF auth.uid() IS NULL OR NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF NOT FOUND OR NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
    SELECT revision INTO v_revision FROM public.whatsapp_automation_settings WHERE workspace_id = p_workspace_id FOR UPDATE;
    IF NOT FOUND OR v_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Settings changed' USING ERRCODE = '40001'; END IF;
    IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' OR octet_length(p_settings::text) > 16000
        OR NOT (p_settings ?& ARRAY['mode','language','business_rules','working_hours_enabled','timezone','working_days','start_minute','end_minute'])
        OR (p_settings - ARRAY['mode','language','business_rules','working_hours_enabled','timezone','working_days','start_minute','end_minute']) <> '{}'::jsonb
        OR jsonb_typeof(p_settings->'mode') <> 'string'
        OR jsonb_typeof(p_settings->'language') <> 'string'
        OR jsonb_typeof(p_settings->'business_rules') <> 'string'
        OR jsonb_typeof(p_settings->'timezone') <> 'string'
        OR jsonb_typeof(p_settings->'start_minute') <> 'number'
        OR jsonb_typeof(p_settings->'end_minute') <> 'number'
        OR jsonb_typeof(p_settings->'working_hours_enabled') <> 'boolean'
        OR jsonb_typeof(p_settings->'working_days') <> 'array'
        OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_settings->>'timezone')
    THEN RAISE EXCEPTION 'Invalid settings' USING ERRCODE = '22023'; END IF;
    IF jsonb_array_length(p_settings->'working_days') NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'Invalid working days' USING ERRCODE = '22023'; END IF;
    SELECT array_agg(value::integer ORDER BY value::integer) INTO v_days FROM jsonb_array_elements_text(p_settings->'working_days');
    IF cardinality(v_days) <> (SELECT count(DISTINCT day) FROM unnest(v_days) day) THEN RAISE EXCEPTION 'Duplicate working day' USING ERRCODE = '22023'; END IF;
    UPDATE public.whatsapp_automation_settings SET mode = p_settings->>'mode',language = p_settings->>'language',business_rules = p_settings->>'business_rules',
        working_hours_enabled = (p_settings->>'working_hours_enabled')::boolean,timezone = p_settings->>'timezone',working_days = v_days,
        start_minute = (p_settings->>'start_minute')::integer,end_minute = (p_settings->>'end_minute')::integer,
        revision = revision + 1,updated_by = auth.uid(),updated_at = now() WHERE workspace_id = p_workspace_id;
    INSERT INTO public.whatsapp_automation_audit(workspace_id,actor_id,event,settings_revision) VALUES (p_workspace_id,auth.uid(),'settings_updated',v_revision+1);
END;
$function$;

-- Reused before reservation AND completion. Caller holds workspace/conversation
-- locks in the same order as Phase 7A. Time is database time, never client time.
CREATE FUNCTION workspace_private.check_whatsapp_automation(p_workspace_id uuid,p_conversation_id uuid,p_position integer,p_revision integer,p_state_revision integer,p_settings_revision integer)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE c public.ai_conversations%ROWTYPE; s public.whatsapp_automation_settings%ROWTYPE; v_source uuid; v_body text; v_local timestamp; v_minute integer;
BEGIN
    SELECT * INTO c FROM workspace_private.lock_whatsapp_inbox(p_workspace_id,p_conversation_id);
    SELECT * INTO s FROM public.whatsapp_automation_settings WHERE workspace_id = p_workspace_id;
    IF NOT FOUND OR s.mode <> 'draft_only' OR s.revision IS DISTINCT FROM p_settings_revision
        OR c.revision IS DISTINCT FROM p_revision OR c.status <> 'open'
        OR p_position IS DISTINCT FROM workspace_private.latest_whatsapp_inbox_position(p_workspace_id,p_conversation_id)
        OR NOT EXISTS (SELECT 1 FROM public.whatsapp_inbox_state WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id AND status = 'open' AND NOT human_takeover AND revision = p_state_revision)
        OR NOT EXISTS (SELECT 1 FROM public.whatsapp_connections WHERE workspace_id = p_workspace_id AND id = c.connection_id AND is_test AND status = 'active')
    THEN RAISE EXCEPTION 'Automation blocked or stale' USING ERRCODE = '40001'; END IF;
    SELECT i.id,i.body INTO v_source,v_body FROM public.ai_messages m JOIN public.whatsapp_inbound_messages i ON i.workspace_id = m.workspace_id AND i.id = m.inbound_message_id
        WHERE m.workspace_id = p_workspace_id AND m.conversation_id = p_conversation_id AND m.position = p_position AND m.role = 'user' AND m.provider = 'customer'
            AND i.connection_id = c.connection_id AND i.message_type = 'text' AND i.body = m.content;
    IF NOT FOUND THEN RAISE EXCEPTION 'Verified text required' USING ERRCODE = '42501'; END IF;
    v_body := normalize(v_body, NFKC);
    IF s.working_hours_enabled AND v_body !~* '\m(human|representative|person|someone|staff)\M|موظف|انسان|بشري|مسؤول|مسوول' THEN
        v_local := clock_timestamp() AT TIME ZONE s.timezone;
        v_minute := extract(hour FROM v_local)::integer * 60 + extract(minute FROM v_local)::integer;
        IF NOT (extract(dow FROM v_local)::integer = ANY(s.working_days)) OR v_minute < s.start_minute OR v_minute >= s.end_minute THEN RAISE EXCEPTION 'Outside working hours' USING ERRCODE = '42501'; END IF;
    END IF;
    RETURN v_source;
END;
$function$;
CREATE FUNCTION public.reserve_whatsapp_automation(p_workspace_id uuid,p_conversation_id uuid,p_position integer,p_revision integer,p_state_revision integer,p_settings_revision integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_source uuid; v_token uuid; v_body text; v_connection uuid; v_agent jsonb; v_attempt integer; v_status text; v_updated timestamptz;
BEGIN
    v_source := workspace_private.check_whatsapp_automation(p_workspace_id,p_conversation_id,p_position,p_revision,p_state_revision,p_settings_revision);
    SELECT connection_id INTO v_connection FROM public.ai_conversations WHERE workspace_id = p_workspace_id AND id = p_conversation_id;
    SELECT status,attempts,updated_at INTO v_status,v_attempt,v_updated FROM public.whatsapp_automation_runs WHERE workspace_id = p_workspace_id AND source_message_id = v_source;
    IF FOUND AND (v_status <> 'generating' OR v_attempt >= 3 OR v_updated > now() - interval '5 minutes') THEN RAISE EXCEPTION 'Already processed or reserved' USING ERRCODE = '40001'; END IF;
    SELECT normalize(body, NFKC) INTO v_body FROM public.whatsapp_inbound_messages WHERE workspace_id = p_workspace_id AND id = v_source;
    IF v_body !~* '\m(human|representative|person|someone|staff)\M|موظف|انسان|بشري|مسؤول|مسوول' AND EXISTS (SELECT 1 FROM public.whatsapp_reply_drafts WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id AND source_message_id = v_source AND status <> 'discarded') THEN RAISE EXCEPTION 'Active draft exists' USING ERRCODE = '40001'; END IF;
    PERFORM public.reserve_whatsapp_inbox_generation(p_workspace_id,p_conversation_id,p_revision,p_position);
    IF v_body ~* '\m(human|representative|person|someone|staff)\M|موظف|انسان|بشري|مسؤول|مسوول' THEN
        PERFORM public.manage_whatsapp_inbox(p_workspace_id,p_conversation_id,'pending_human',true,
            (SELECT assigned_user_id FROM public.whatsapp_inbox_state WHERE workspace_id=p_workspace_id AND conversation_id=p_conversation_id),p_state_revision);
        v_status := 'pending_human';
    ELSE
        SELECT to_jsonb(a) INTO v_agent FROM public.ai_agent_settings a WHERE workspace_id = p_workspace_id AND enabled;
        IF NOT FOUND THEN RAISE EXCEPTION 'Agent disabled' USING ERRCODE = '42501'; END IF;
        v_status := 'generating';
    END IF;
    INSERT INTO public.whatsapp_automation_runs AS r(workspace_id,conversation_id,connection_id,source_message_id,source_position,status,conversation_revision,state_revision,settings_revision,agent_snapshot,created_by)
        VALUES (p_workspace_id,p_conversation_id,v_connection,v_source,p_position,v_status,p_revision,p_state_revision,p_settings_revision,v_agent,auth.uid())
        ON CONFLICT (workspace_id,source_message_id) DO UPDATE SET token=gen_random_uuid(),attempts=r.attempts+1,status=EXCLUDED.status,
            conversation_revision=p_revision,state_revision=p_state_revision,settings_revision=p_settings_revision,agent_snapshot=v_agent,created_by=auth.uid(),updated_at=now()
        RETURNING token INTO v_token;
    INSERT INTO public.whatsapp_automation_audit(workspace_id,actor_id,event,source_message_id,settings_revision)
        VALUES (p_workspace_id,auth.uid(),CASE WHEN v_status='pending_human' THEN v_status WHEN v_attempt IS NULL THEN 'reserved' ELSE 'retried' END,v_source,p_settings_revision);
    RETURN CASE WHEN v_status='pending_human' THEN v_status ELSE v_token::text END;
END;
$function$;
CREATE FUNCTION public.complete_whatsapp_automation(p_workspace_id uuid,p_conversation_id uuid,p_token uuid,p_content text,p_refs jsonb,p_context_count integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE r public.whatsapp_automation_runs%ROWTYPE; v_source uuid; v_draft uuid; v_agent jsonb;
BEGIN
    PERFORM workspace_private.lock_whatsapp_inbox(p_workspace_id,p_conversation_id);
    SELECT * INTO r FROM public.whatsapp_automation_runs WHERE workspace_id=p_workspace_id AND conversation_id=p_conversation_id AND token=p_token FOR UPDATE;
    IF NOT FOUND OR r.created_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Reservation unavailable' USING ERRCODE='42501'; END IF;
    -- Exact retry returns the saved LOCAL draft ID. It never re-approves/sends.
    IF r.status='draft' THEN RETURN r.draft_id; END IF;
    IF r.status <> 'generating' OR r.updated_at < now()-interval '5 minutes' THEN RAISE EXCEPTION 'Reservation expired' USING ERRCODE='40001'; END IF;
    v_source := workspace_private.check_whatsapp_automation(p_workspace_id,p_conversation_id,r.source_position,r.conversation_revision,r.state_revision,r.settings_revision);
    SELECT to_jsonb(a) INTO v_agent FROM public.ai_agent_settings a WHERE workspace_id=p_workspace_id AND enabled;
    IF v_agent IS NULL OR v_agent IS DISTINCT FROM r.agent_snapshot OR v_source IS DISTINCT FROM r.source_message_id THEN RAISE EXCEPTION 'Configuration changed' USING ERRCODE='40001'; END IF;
    v_draft := public.create_whatsapp_inbox_draft(p_workspace_id,p_conversation_id,r.source_message_id,r.source_position,r.conversation_revision,p_content,'demo',p_refs,p_context_count);
    UPDATE public.whatsapp_automation_runs SET status='draft',draft_id=v_draft,updated_at=now() WHERE workspace_id=p_workspace_id AND source_message_id=r.source_message_id;
    INSERT INTO public.whatsapp_automation_audit(workspace_id,actor_id,event,source_message_id,settings_revision) VALUES(p_workspace_id,auth.uid(),'draft_created',r.source_message_id,r.settings_revision);
    RETURN v_draft;
END;
$function$;

ALTER FUNCTION workspace_private.initialize_whatsapp_automation() OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.initialize_whatsapp_automation() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION workspace_private.check_whatsapp_automation(uuid,uuid,integer,integer,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.check_whatsapp_automation(uuid,uuid,integer,integer,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.save_whatsapp_automation_settings(uuid,integer,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_whatsapp_automation_settings(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_whatsapp_automation_settings(uuid,integer,jsonb) TO authenticated;
ALTER FUNCTION public.reserve_whatsapp_automation(uuid,uuid,integer,integer,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_whatsapp_automation(uuid,uuid,integer,integer,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_whatsapp_automation(uuid,uuid,integer,integer,integer,integer) TO authenticated;
ALTER FUNCTION public.complete_whatsapp_automation(uuid,uuid,uuid,text,jsonb,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_whatsapp_automation(uuid,uuid,uuid,text,jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.complete_whatsapp_automation(uuid,uuid,uuid,text,jsonb,integer) TO authenticated;
COMMIT;

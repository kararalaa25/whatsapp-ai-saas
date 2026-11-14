-- UNAPPLIED Phase 7A. Requires existing Phase 4/5A/5B/6A migrations.
-- Adds local owner-only workflow metadata; no sending/outbox/external calls.
BEGIN;

CREATE TABLE public.whatsapp_inbox_state (
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending_human','closed')),
    human_takeover boolean NOT NULL DEFAULT false,
    assigned_user_id uuid,
    last_read_position integer NOT NULL DEFAULT 0 CHECK (last_read_position >= 0),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, conversation_id),
    FOREIGN KEY (workspace_id, conversation_id) REFERENCES public.ai_conversations(workspace_id, id),
    FOREIGN KEY (workspace_id, assigned_user_id) REFERENCES public.workspace_members(workspace_id, user_id),
    CHECK (status <> 'pending_human' OR human_takeover)
);
CREATE TABLE public.whatsapp_reply_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    source_message_id uuid NOT NULL,
    source_position integer NOT NULL CHECK (source_position > 0),
    content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 6000 AND content ~ '[^[:space:]]'),
    provider text NOT NULL CHECK (provider IN ('demo','openai','manual')),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','discarded')),
    edited boolean NOT NULL DEFAULT false,
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    knowledge_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(knowledge_refs) = 'array' AND jsonb_array_length(knowledge_refs) <= 8 AND octet_length(knowledge_refs::text) <= 50000),
    context_count integer NOT NULL DEFAULT 0 CHECK (context_count BETWEEN 0 AND 12),
    created_by uuid NOT NULL REFERENCES auth.users(id),
    approved_by uuid REFERENCES auth.users(id),
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, conversation_id) REFERENCES public.ai_conversations(workspace_id, id),
    FOREIGN KEY (workspace_id, source_message_id) REFERENCES public.whatsapp_inbound_messages(workspace_id, id),
    CHECK ((status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
        OR (status <> 'approved' AND approved_by IS NULL AND approved_at IS NULL))
);
CREATE UNIQUE INDEX whatsapp_drafts_one_active_source ON public.whatsapp_reply_drafts(workspace_id, conversation_id, source_message_id) WHERE status IN ('draft','approved');
CREATE INDEX whatsapp_drafts_conversation_created ON public.whatsapp_reply_drafts(workspace_id, conversation_id, created_at DESC, id DESC);
CREATE INDEX whatsapp_drafts_source_fk ON public.whatsapp_reply_drafts(workspace_id, source_message_id);
CREATE INDEX whatsapp_inbox_assignee_fk ON public.whatsapp_inbox_state(workspace_id, assigned_user_id);
CREATE INDEX whatsapp_inbox_verified_messages_page ON public.ai_messages(workspace_id, conversation_id, position DESC) WHERE role = 'user' AND provider = 'customer' AND inbound_message_id IS NOT NULL;
CREATE INDEX whatsapp_inbox_conversations_page ON public.ai_conversations(workspace_id, updated_at DESC, id DESC) WHERE channel = 'whatsapp_test';
ALTER TABLE public.whatsapp_inbox_state OWNER TO postgres;
ALTER TABLE public.whatsapp_reply_drafts OWNER TO postgres;
ALTER TABLE public.whatsapp_inbox_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_reply_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_inbox_state, public.whatsapp_reply_drafts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.whatsapp_inbox_state, public.whatsapp_reply_drafts TO authenticated;
CREATE POLICY inbox_owner_read ON public.whatsapp_inbox_state FOR SELECT TO authenticated USING (workspace_private.is_workspace_owner(workspace_id));
CREATE POLICY inbox_drafts_owner_read ON public.whatsapp_reply_drafts FOR SELECT TO authenticated USING (workspace_private.is_workspace_owner(workspace_id));

CREATE TABLE workspace_private.whatsapp_inbox_usage (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    period text NOT NULL CHECK (period IN ('minute','day')),
    bucket timestamptz NOT NULL,
    used integer NOT NULL CHECK (used BETWEEN 1 AND 100),
    PRIMARY KEY (user_id, period, bucket)
);
ALTER TABLE workspace_private.whatsapp_inbox_usage OWNER TO postgres;
ALTER TABLE workspace_private.whatsapp_inbox_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE workspace_private.whatsapp_inbox_usage FROM PUBLIC, anon, authenticated, service_role;

-- Initialize metadata only, never fabricate/backfill customer messages.
INSERT INTO public.whatsapp_inbox_state(workspace_id, conversation_id, status, human_takeover)
SELECT workspace_id, id, status, status = 'closed' FROM public.ai_conversations WHERE channel = 'whatsapp_test';
CREATE FUNCTION workspace_private.initialize_whatsapp_inbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
    INSERT INTO public.whatsapp_inbox_state(workspace_id, conversation_id, status, human_takeover)
    VALUES (NEW.workspace_id, NEW.id, NEW.status, NEW.status = 'closed');
    RETURN NEW;
END;
$function$;
CREATE TRIGGER initialize_whatsapp_inbox AFTER INSERT ON public.ai_conversations
    FOR EACH ROW WHEN (NEW.channel = 'whatsapp_test') EXECUTE FUNCTION workspace_private.initialize_whatsapp_inbox();

CREATE FUNCTION workspace_private.sync_whatsapp_inbox_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
    -- Legacy Studio reopen never silently releases human control.
    UPDATE public.whatsapp_inbox_state SET status = CASE WHEN NEW.status = 'closed' THEN 'closed' ELSE 'pending_human' END,
        human_takeover = true, revision = revision + 1, updated_at = now()
    WHERE workspace_id = NEW.workspace_id AND conversation_id = NEW.id;
    RETURN NEW;
END;
$function$;
CREATE TRIGGER sync_whatsapp_inbox_status AFTER UPDATE OF status ON public.ai_conversations
    FOR EACH ROW WHEN (NEW.channel = 'whatsapp_test' AND NEW.status IS DISTINCT FROM OLD.status) EXECUTE FUNCTION workspace_private.sync_whatsapp_inbox_status();

CREATE FUNCTION workspace_private.guard_whatsapp_inbox_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_connection uuid; v_status text;
BEGIN
    SELECT connection_id, status INTO v_connection, v_status FROM public.ai_conversations
        WHERE workspace_id = NEW.workspace_id AND id = NEW.conversation_id AND channel = 'whatsapp_test';
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF NEW.role = 'user' THEN
        IF NEW.provider <> 'customer' OR NEW.inbound_message_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.whatsapp_inbound_messages i WHERE i.workspace_id = NEW.workspace_id
                AND i.id = NEW.inbound_message_id AND i.connection_id = v_connection
                AND i.message_type = 'text' AND i.body = NEW.content
        ) THEN RAISE EXCEPTION 'Verified inbound source required' USING ERRCODE = '42501'; END IF;
    ELSIF v_status <> 'open' OR NOT EXISTS (
        SELECT 1 FROM public.whatsapp_inbox_state s WHERE s.workspace_id = NEW.workspace_id
            AND s.conversation_id = NEW.conversation_id AND s.status = 'open' AND NOT s.human_takeover
    ) THEN RAISE EXCEPTION 'Human control blocks legacy generation' USING ERRCODE = '42501'; END IF;
    RETURN NEW;
END;
$function$;
CREATE TRIGGER guard_whatsapp_inbox_message BEFORE INSERT ON public.ai_messages
    FOR EACH ROW EXECUTE FUNCTION workspace_private.guard_whatsapp_inbox_message();
CREATE FUNCTION workspace_private.receive_whatsapp_inbox_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM public.ai_conversations WHERE workspace_id = NEW.workspace_id AND id = NEW.conversation_id AND channel = 'whatsapp_test') THEN
        UPDATE public.whatsapp_inbox_state SET revision = revision + 1, updated_at = now()
            WHERE workspace_id = NEW.workspace_id AND conversation_id = NEW.conversation_id;
        -- A new text to a closed thread goes to human review, not auto-generation.
        UPDATE public.ai_conversations SET status = 'open'
            WHERE workspace_id = NEW.workspace_id AND id = NEW.conversation_id AND status = 'closed';
    END IF;
    RETURN NEW;
END;
$function$;
CREATE TRIGGER receive_whatsapp_inbox_message AFTER INSERT ON public.ai_messages
    FOR EACH ROW WHEN (NEW.role = 'user' AND NEW.inbound_message_id IS NOT NULL) EXECUTE FUNCTION workspace_private.receive_whatsapp_inbox_message();

CREATE FUNCTION workspace_private.lock_whatsapp_inbox(p_workspace_id uuid, p_conversation_id uuid)
RETURNS public.ai_conversations LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_conversation public.ai_conversations%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF NOT FOUND OR NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_conversation FROM public.ai_conversations WHERE workspace_id = p_workspace_id AND id = p_conversation_id AND channel = 'whatsapp_test' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE = '42501'; END IF;
    RETURN v_conversation;
END;
$function$;
CREATE FUNCTION workspace_private.latest_whatsapp_inbox_position(p_workspace_id uuid, p_conversation_id uuid)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $function$
    SELECT COALESCE(max(m.position), 0) FROM public.ai_messages m
    JOIN public.ai_conversations c ON c.workspace_id = m.workspace_id AND c.id = m.conversation_id AND c.channel = 'whatsapp_test'
    JOIN public.whatsapp_inbound_messages i ON i.workspace_id = m.workspace_id AND i.id = m.inbound_message_id AND i.connection_id = c.connection_id AND i.body = m.content AND i.message_type = 'text'
    WHERE m.workspace_id = p_workspace_id AND m.conversation_id = p_conversation_id AND m.role = 'user' AND m.provider = 'customer';
$function$;

CREATE FUNCTION public.list_whatsapp_inbox(p_workspace_id uuid, p_before_at timestamptz, p_before_id uuid, p_status text)
RETURNS TABLE (id uuid, connection_id uuid, customer_wa_id text, updated_at timestamptz, status text, human_takeover boolean, assigned_user_id uuid, unread_count bigint, recent_message text, latest_received_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
    IF auth.uid() IS NULL OR NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
    IF p_status IS NULL OR p_status NOT IN ('all','open','pending_human','closed') OR (p_before_at IS NULL) <> (p_before_id IS NULL) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE = '22023'; END IF;
    RETURN QUERY SELECT c.id, c.connection_id, c.customer_wa_id, c.updated_at, s.status, s.human_takeover, s.assigned_user_id,
        (SELECT count(*) FROM public.ai_messages m JOIN public.whatsapp_inbound_messages i ON i.workspace_id = m.workspace_id AND i.id = m.inbound_message_id AND i.connection_id = c.connection_id AND i.body = m.content AND i.message_type = 'text'
            WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id AND m.role = 'user' AND m.provider = 'customer' AND m.position > s.last_read_position),
        left(latest.body, 160), latest.received_at
    FROM public.ai_conversations c JOIN public.whatsapp_inbox_state s ON s.workspace_id = c.workspace_id AND s.conversation_id = c.id
    LEFT JOIN LATERAL (
        SELECT i.body, i.received_at FROM public.ai_messages m JOIN public.whatsapp_inbound_messages i ON i.workspace_id = m.workspace_id AND i.id = m.inbound_message_id AND i.connection_id = c.connection_id AND i.body = m.content AND i.message_type = 'text'
        WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id AND m.role = 'user' AND m.provider = 'customer' ORDER BY m.position DESC LIMIT 1
    ) latest ON true
    WHERE c.workspace_id = p_workspace_id AND c.channel = 'whatsapp_test' AND (p_status = 'all' OR s.status = p_status)
        AND (p_before_at IS NULL OR (c.updated_at, c.id) < (p_before_at, p_before_id))
    ORDER BY c.updated_at DESC, c.id DESC LIMIT 31;
END;
$function$;

CREATE FUNCTION public.manage_whatsapp_inbox(p_workspace_id uuid, p_conversation_id uuid, p_status text, p_takeover boolean, p_assignee uuid, p_revision integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_conversation public.ai_conversations%ROWTYPE; v_state public.whatsapp_inbox_state%ROWTYPE;
BEGIN
    SELECT * INTO v_conversation FROM workspace_private.lock_whatsapp_inbox(p_workspace_id, p_conversation_id);
    SELECT * INTO STRICT v_state FROM public.whatsapp_inbox_state WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id FOR UPDATE;
    IF v_state.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'State changed' USING ERRCODE = '40001'; END IF;
    IF p_status IS NULL OR p_status NOT IN ('open','pending_human','closed') OR p_takeover IS NULL THEN RAISE EXCEPTION 'Invalid control' USING ERRCODE = '22023'; END IF;
    IF p_assignee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_assignee) THEN RAISE EXCEPTION 'Foreign assignee' USING ERRCODE = '42501'; END IF;
    UPDATE public.ai_conversations SET status = CASE WHEN p_status = 'closed' THEN 'closed' ELSE 'open' END, revision = revision + 1, updated_at = now() WHERE workspace_id = p_workspace_id AND id = p_conversation_id;
    UPDATE public.whatsapp_inbox_state SET status = p_status, human_takeover = p_takeover OR p_status IN ('pending_human','closed'), assigned_user_id = p_assignee, revision = revision + 1, updated_at = now()
        WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id;
END;
$function$;
CREATE FUNCTION public.mark_whatsapp_inbox_read(p_workspace_id uuid, p_conversation_id uuid, p_position integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
    PERFORM workspace_private.lock_whatsapp_inbox(p_workspace_id, p_conversation_id);
    IF p_position IS NULL OR p_position < 1 OR NOT EXISTS (SELECT 1 FROM public.ai_messages m JOIN public.whatsapp_inbound_messages i ON i.workspace_id = m.workspace_id AND i.id = m.inbound_message_id JOIN public.ai_conversations c ON c.workspace_id = m.workspace_id AND c.id = m.conversation_id
        WHERE m.workspace_id = p_workspace_id AND m.conversation_id = p_conversation_id AND m.position = p_position AND m.role = 'user' AND m.provider = 'customer' AND i.connection_id = c.connection_id AND i.body = m.content AND i.message_type = 'text') THEN RAISE EXCEPTION 'Invalid read position' USING ERRCODE = '22023'; END IF;
    UPDATE public.whatsapp_inbox_state SET last_read_position = greatest(last_read_position, p_position) WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id;
END;
$function$;
CREATE FUNCTION public.reserve_whatsapp_inbox_generation(p_workspace_id uuid, p_conversation_id uuid, p_revision integer, p_position integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_conversation public.ai_conversations%ROWTYPE; v_period text; v_limit integer; v_used integer;
BEGIN
    SELECT * INTO v_conversation FROM workspace_private.lock_whatsapp_inbox(p_workspace_id, p_conversation_id);
    IF v_conversation.revision IS DISTINCT FROM p_revision OR v_conversation.status <> 'open' OR NOT EXISTS (SELECT 1 FROM public.whatsapp_inbox_state WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id AND status = 'open' AND NOT human_takeover)
        OR p_position IS DISTINCT FROM workspace_private.latest_whatsapp_inbox_position(p_workspace_id, p_conversation_id) OR p_position < 1 THEN RAISE EXCEPTION 'Generation blocked' USING ERRCODE = '40001'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_connections WHERE workspace_id = p_workspace_id AND id = v_conversation.connection_id AND is_test AND status = 'active') THEN RAISE EXCEPTION 'Test connection unavailable' USING ERRCODE = '42501'; END IF;
    DELETE FROM workspace_private.whatsapp_inbox_usage WHERE user_id = auth.uid() AND bucket < now() - interval '2 days';
    FOR v_period, v_limit IN SELECT * FROM (VALUES ('minute',6),('day',100)) limits(period, maximum) LOOP
        v_used := NULL;
        INSERT INTO workspace_private.whatsapp_inbox_usage AS quota(user_id, period, bucket, used)
        VALUES (auth.uid(), v_period, date_trunc(v_period, now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 1)
        ON CONFLICT (user_id, period, bucket) DO UPDATE SET used = quota.used + 1 WHERE quota.used < v_limit RETURNING used INTO v_used;
        IF v_used IS NULL THEN RAISE EXCEPTION 'Generation limit reached' USING ERRCODE = '54000'; END IF;
    END LOOP;
END;
$function$;

CREATE FUNCTION workspace_private.whatsapp_inbox_references(p_workspace_id uuid, p_refs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE item jsonb; actual jsonb; result jsonb := '[]'; reason text;
BEGIN
    IF p_refs IS NULL OR jsonb_typeof(p_refs) <> 'array' OR jsonb_array_length(p_refs) > 8 OR octet_length(p_refs::text) > 50000 THEN RAISE EXCEPTION 'Invalid references' USING ERRCODE = '22023'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_refs) LOOP
        actual := NULL;
        IF item ->> 'type' = 'product' THEN
            SELECT jsonb_build_object('name',name,'description',description,'category',category,'sku',sku,'price',price,'currency',currency,'stock_status',stock_status) INTO actual
            FROM public.business_products WHERE workspace_id = p_workspace_id AND id = (item ->> 'id')::uuid AND active;
        ELSIF item ->> 'type' = 'faq' THEN
            SELECT jsonb_build_object('question',question,'answer',answer) INTO actual FROM public.business_faqs WHERE workspace_id = p_workspace_id AND id = (item ->> 'id')::uuid AND active;
        ELSIF item ->> 'type' = 'information' THEN
            SELECT jsonb_build_object('topic',topic,'content',content) INTO actual FROM public.business_information WHERE workspace_id = p_workspace_id AND id = (item ->> 'id')::uuid;
        END IF;
        IF actual IS NULL OR actual IS DISTINCT FROM (item -> 'data') THEN RAISE EXCEPTION 'Knowledge changed or unavailable' USING ERRCODE = '40001'; END IF;
        reason := item ->> 'reason';
        IF reason IS NULL OR reason NOT IN ('name','spelling','transliteration','keyword','history','variant') THEN reason := 'keyword'; END IF;
        result := result || jsonb_build_array(jsonb_build_object('type',item ->> 'type','id',item ->> 'id','data',actual,'reason',reason));
    END LOOP;
    RETURN result;
END;
$function$;
CREATE FUNCTION public.create_whatsapp_inbox_draft(p_workspace_id uuid, p_conversation_id uuid, p_source_id uuid, p_position integer, p_revision integer, p_content text, p_provider text, p_refs jsonb, p_context_count integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_conversation public.ai_conversations%ROWTYPE; v_id uuid; v_refs jsonb;
BEGIN
    SELECT * INTO v_conversation FROM workspace_private.lock_whatsapp_inbox(p_workspace_id, p_conversation_id);
    IF v_conversation.revision IS DISTINCT FROM p_revision OR v_conversation.status <> 'open' OR p_position IS DISTINCT FROM workspace_private.latest_whatsapp_inbox_position(p_workspace_id, p_conversation_id) THEN RAISE EXCEPTION 'Conversation changed' USING ERRCODE = '40001'; END IF;
    IF p_provider IS NULL OR p_provider NOT IN ('demo','openai','manual') OR p_content IS NULL OR char_length(btrim(p_content)) NOT BETWEEN 1 AND 6000 OR p_context_count IS NULL OR p_context_count NOT BETWEEN 0 AND 12 THEN RAISE EXCEPTION 'Invalid draft' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_inbox_state WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id AND status <> 'closed' AND (p_provider = 'manual' OR (status = 'open' AND NOT human_takeover))) THEN RAISE EXCEPTION 'Human control blocks generation' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ai_messages m JOIN public.whatsapp_inbound_messages i ON i.workspace_id = m.workspace_id AND i.id = m.inbound_message_id
        WHERE m.workspace_id = p_workspace_id AND m.conversation_id = p_conversation_id AND m.position = p_position AND m.inbound_message_id = p_source_id AND m.role = 'user' AND m.provider = 'customer' AND i.connection_id = v_conversation.connection_id AND i.body = m.content AND i.message_type = 'text') THEN RAISE EXCEPTION 'Verified source required' USING ERRCODE = '42501'; END IF;
    IF (SELECT count(*) FROM public.whatsapp_reply_drafts WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id) >= 100 THEN RAISE EXCEPTION 'Draft limit reached' USING ERRCODE = '54000'; END IF;
    IF p_provider = 'manual' AND p_refs IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Manual references must be empty' USING ERRCODE = '22023'; END IF;
    v_refs := workspace_private.whatsapp_inbox_references(p_workspace_id, p_refs);
    INSERT INTO public.whatsapp_reply_drafts(workspace_id, conversation_id, source_message_id, source_position, content, provider, knowledge_refs, context_count, created_by)
        VALUES (p_workspace_id, p_conversation_id, p_source_id, p_position, btrim(p_content), p_provider, v_refs, p_context_count, auth.uid()) RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$;
CREATE FUNCTION public.update_whatsapp_inbox_draft(p_workspace_id uuid, p_conversation_id uuid, p_draft_id uuid, p_revision integer, p_operation text, p_content text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_conversation public.ai_conversations%ROWTYPE; v_draft public.whatsapp_reply_drafts%ROWTYPE;
BEGIN
    SELECT * INTO v_conversation FROM workspace_private.lock_whatsapp_inbox(p_workspace_id, p_conversation_id);
    SELECT * INTO v_draft FROM public.whatsapp_reply_drafts WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id AND id = p_draft_id FOR UPDATE;
    IF NOT FOUND OR v_draft.status = 'discarded' THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE = '42501'; END IF;
    IF v_draft.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Draft changed' USING ERRCODE = '40001'; END IF;
    IF p_operation = 'edit' THEN
        IF v_conversation.status = 'closed' OR p_content IS NULL OR char_length(btrim(p_content)) NOT BETWEEN 1 AND 6000 THEN RAISE EXCEPTION 'Invalid edit' USING ERRCODE = '22023'; END IF;
        UPDATE public.whatsapp_reply_drafts SET content = btrim(p_content), status = 'draft', edited = true, approved_by = NULL, approved_at = NULL, revision = revision + 1, updated_at = now()
            WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id AND id = p_draft_id;
    ELSIF p_operation = 'approve' THEN
        PERFORM workspace_private.whatsapp_inbox_references(p_workspace_id, v_draft.knowledge_refs);
        IF v_conversation.status = 'closed' OR v_draft.status <> 'draft' OR v_draft.source_position IS DISTINCT FROM workspace_private.latest_whatsapp_inbox_position(p_workspace_id, p_conversation_id) THEN RAISE EXCEPTION 'Stale draft cannot be approved' USING ERRCODE = '40001'; END IF;
        UPDATE public.whatsapp_reply_drafts SET status = 'approved', approved_by = auth.uid(), approved_at = now(), revision = revision + 1, updated_at = now()
            WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id AND id = p_draft_id;
    ELSIF p_operation = 'discard' THEN
        UPDATE public.whatsapp_reply_drafts SET status = 'discarded', approved_by = NULL, approved_at = NULL, revision = revision + 1, updated_at = now()
            WHERE workspace_id = p_workspace_id AND conversation_id = p_conversation_id AND id = p_draft_id;
    ELSE RAISE EXCEPTION 'Invalid draft operation' USING ERRCODE = '22023'; END IF;
END;
$function$;

ALTER FUNCTION workspace_private.initialize_whatsapp_inbox() OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.initialize_whatsapp_inbox() FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION workspace_private.sync_whatsapp_inbox_status() OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.sync_whatsapp_inbox_status() FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION workspace_private.guard_whatsapp_inbox_message() OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.guard_whatsapp_inbox_message() FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION workspace_private.receive_whatsapp_inbox_message() OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.receive_whatsapp_inbox_message() FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION workspace_private.lock_whatsapp_inbox(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.lock_whatsapp_inbox(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION workspace_private.latest_whatsapp_inbox_position(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.latest_whatsapp_inbox_position(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION workspace_private.whatsapp_inbox_references(uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.whatsapp_inbox_references(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.list_whatsapp_inbox(uuid,timestamptz,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_whatsapp_inbox(uuid,timestamptz,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_whatsapp_inbox(uuid,timestamptz,uuid,text) TO authenticated;

ALTER FUNCTION public.manage_whatsapp_inbox(uuid,uuid,text,boolean,uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.manage_whatsapp_inbox(uuid,uuid,text,boolean,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manage_whatsapp_inbox(uuid,uuid,text,boolean,uuid,integer) TO authenticated;

ALTER FUNCTION public.mark_whatsapp_inbox_read(uuid,uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_whatsapp_inbox_read(uuid,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_whatsapp_inbox_read(uuid,uuid,integer) TO authenticated;

ALTER FUNCTION public.reserve_whatsapp_inbox_generation(uuid,uuid,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_whatsapp_inbox_generation(uuid,uuid,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_whatsapp_inbox_generation(uuid,uuid,integer,integer) TO authenticated;

ALTER FUNCTION public.create_whatsapp_inbox_draft(uuid,uuid,uuid,integer,integer,text,text,jsonb,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_whatsapp_inbox_draft(uuid,uuid,uuid,integer,integer,text,text,jsonb,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_inbox_draft(uuid,uuid,uuid,integer,integer,text,text,jsonb,integer) TO authenticated;

ALTER FUNCTION public.update_whatsapp_inbox_draft(uuid,uuid,uuid,integer,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_whatsapp_inbox_draft(uuid,uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_whatsapp_inbox_draft(uuid,uuid,uuid,integer,text,text) TO authenticated;

COMMIT;

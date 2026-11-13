-- UNAPPLIED Phase 5B. Requires BOTH existing workspace and WhatsApp migrations.
-- No backfill, sending, or automatic model calls. Existing test rows are untouched.
BEGIN;

CREATE FUNCTION workspace_private.is_workspace_owner(p_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
    SELECT EXISTS (SELECT 1 FROM public.workspace_members AS m
        WHERE m.workspace_id = p_workspace_id AND m.user_id = (SELECT auth.uid())
        AND m.role = 'owner');
$function$;
ALTER FUNCTION workspace_private.is_workspace_owner(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.is_workspace_owner(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION workspace_private.is_workspace_owner(uuid) TO authenticated;

CREATE TABLE public.ai_agent_settings (
    workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE RESTRICT,
    business_description text NOT NULL DEFAULT '' CHECK (char_length(business_description) <= 3000),
    instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 4000),
    language text NOT NULL DEFAULT 'auto' CHECK (language IN ('auto', 'en', 'ar')),
    tone text NOT NULL DEFAULT 'professional' CHECK (tone IN ('professional', 'friendly', 'concise')),
    model text NOT NULL DEFAULT 'gpt-4.1-mini' CHECK (model IN ('gpt-4.1-mini', 'gpt-4.1')),
    enabled boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
    channel text NOT NULL CHECK (channel IN ('playground', 'whatsapp_test')),
    connection_id uuid,
    customer_wa_id text CHECK (customer_wa_id ~ '^[0-9]{5,32}$'),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    UNIQUE (connection_id, customer_wa_id),
    FOREIGN KEY (workspace_id, connection_id) REFERENCES public.whatsapp_connections(workspace_id, id),
    CHECK ((channel = 'playground' AND connection_id IS NULL AND customer_wa_id IS NULL)
        OR (channel = 'whatsapp_test' AND connection_id IS NOT NULL AND customer_wa_id IS NOT NULL))
);
CREATE INDEX ai_conversations_workspace_updated_idx ON public.ai_conversations(workspace_id, updated_at DESC);

-- Composite identity ensures source-message references cannot cross tenants.
ALTER TABLE public.whatsapp_inbound_messages
    ADD CONSTRAINT whatsapp_inbound_workspace_id_key UNIQUE (workspace_id, id);
CREATE TABLE public.ai_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    position integer NOT NULL CHECK (position > 0),
    role text NOT NULL CHECK (role IN ('user', 'assistant')),
    content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 6000),
    provider text NOT NULL CHECK (provider IN ('customer', 'demo', 'openai')),
    inbound_message_id uuid UNIQUE,
    UNIQUE (conversation_id, position),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, conversation_id) REFERENCES public.ai_conversations(workspace_id, id),
    FOREIGN KEY (workspace_id, inbound_message_id) REFERENCES public.whatsapp_inbound_messages(workspace_id, id),
    CHECK ((role = 'user' AND provider = 'customer') OR (role = 'assistant' AND provider IN ('demo', 'openai'))),
    CHECK (inbound_message_id IS NULL OR role = 'user')
);
CREATE INDEX ai_messages_conversation_position_idx ON public.ai_messages(workspace_id, conversation_id, position);

ALTER TABLE public.ai_agent_settings OWNER TO postgres;
ALTER TABLE public.ai_conversations OWNER TO postgres;
ALTER TABLE public.ai_messages OWNER TO postgres;
ALTER TABLE public.ai_agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_agent_settings, public.ai_conversations, public.ai_messages FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ai_agent_settings, public.ai_conversations, public.ai_messages TO authenticated;
CREATE POLICY ai_settings_owner_read ON public.ai_agent_settings FOR SELECT TO authenticated USING (workspace_private.is_workspace_owner(workspace_id));
CREATE POLICY ai_conversations_owner_read ON public.ai_conversations FOR SELECT TO authenticated USING (workspace_private.is_workspace_owner(workspace_id));
CREATE POLICY ai_messages_owner_read ON public.ai_messages FOR SELECT TO authenticated USING (workspace_private.is_workspace_owner(workspace_id));

-- Per-owner quota across ALL owned workspaces. No API-visible counter table.
CREATE TABLE workspace_private.ai_preview_usage (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    used_on date NOT NULL,
    used integer NOT NULL CHECK (used BETWEEN 1 AND 50),
    PRIMARY KEY (user_id, used_on)
);
ALTER TABLE workspace_private.ai_preview_usage OWNER TO postgres;
ALTER TABLE workspace_private.ai_preview_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE workspace_private.ai_preview_usage FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reserve_ai_preview(p_workspace_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_used integer;
BEGIN
    IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ai_agent_settings WHERE workspace_id = p_workspace_id AND enabled) THEN
        RAISE EXCEPTION 'Agent disabled' USING ERRCODE = '42501';
    END IF;
    INSERT INTO workspace_private.ai_preview_usage AS quota(user_id, used_on, used)
    VALUES (auth.uid(), (now() AT TIME ZONE 'UTC')::date, 1)
    ON CONFLICT (user_id, used_on) DO UPDATE SET used = quota.used + 1
        WHERE quota.used < 50
    RETURNING used INTO v_used;
    IF v_used IS NULL THEN RAISE EXCEPTION 'Daily preview limit reached' USING ERRCODE = '54000'; END IF;
END;
$function$;

CREATE FUNCTION public.save_ai_agent_settings(p_workspace_id uuid, p_description text, p_instructions text, p_language text, p_tone text, p_model text, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
    -- Serialize owner-authorized changes against membership operations that lock this row.
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.ai_agent_settings (workspace_id, business_description, instructions, language, tone, model, enabled)
    VALUES (p_workspace_id, p_description, p_instructions, p_language, p_tone, p_model, p_enabled)
    ON CONFLICT (workspace_id) DO UPDATE SET business_description = EXCLUDED.business_description,
        instructions = EXCLUDED.instructions, language = EXCLUDED.language, tone = EXCLUDED.tone,
        model = EXCLUDED.model, enabled = EXCLUDED.enabled, updated_at = now();
END;
$function$;

CREATE FUNCTION public.create_ai_playground(p_workspace_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_id uuid;
BEGIN
    IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
    INSERT INTO public.ai_conversations (workspace_id, channel, title) VALUES (p_workspace_id, 'playground', 'Playground conversation') RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$;

CREATE FUNCTION public.save_ai_turn(p_workspace_id uuid, p_conversation_id uuid, p_revision integer, p_customer_message text, p_reply text, p_provider text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_conversation public.ai_conversations%ROWTYPE; v_position integer;
BEGIN
    IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_conversation FROM public.ai_conversations WHERE id = p_conversation_id AND workspace_id = p_workspace_id FOR UPDATE;
    IF NOT FOUND OR v_conversation.status <> 'open' THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE = '42501'; END IF;
    IF v_conversation.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Conversation changed; reload' USING ERRCODE = '40001'; END IF;
    IF (SELECT count(*) FROM public.ai_messages WHERE conversation_id = p_conversation_id) >= 100 THEN RAISE EXCEPTION 'Conversation limit reached' USING ERRCODE = '22023'; END IF;
    SELECT COALESCE(max(position), 0) INTO v_position FROM public.ai_messages WHERE conversation_id = p_conversation_id;
    IF v_conversation.channel = 'playground' THEN
        IF p_customer_message IS NULL OR char_length(p_customer_message) NOT BETWEEN 1 AND 3000 THEN RAISE EXCEPTION 'Invalid message' USING ERRCODE = '22023'; END IF;
        v_position := v_position + 1;
        INSERT INTO public.ai_messages(workspace_id, conversation_id, position, role, content, provider)
        VALUES (p_workspace_id, p_conversation_id, v_position, 'user', p_customer_message, 'customer');
    ELSIF p_customer_message IS NOT NULL THEN
        RAISE EXCEPTION 'Test inbox messages cannot be forged' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.ai_messages(workspace_id, conversation_id, position, role, content, provider)
    VALUES (p_workspace_id, p_conversation_id, v_position + 1, 'assistant', p_reply, p_provider);
    UPDATE public.ai_conversations SET revision = revision + 1, updated_at = now() WHERE id = p_conversation_id;
END;
$function$;

CREATE FUNCTION public.set_ai_conversation_status(p_workspace_id uuid, p_conversation_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
    IF NOT workspace_private.is_workspace_owner(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
    IF p_status NOT IN ('open', 'closed') OR p_status IS NULL THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE = '22023'; END IF;
    UPDATE public.ai_conversations SET status = p_status, revision = revision + 1, updated_at = now() WHERE id = p_conversation_id AND workspace_id = p_workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE = '42501'; END IF;
END;
$function$;

-- Additive v2 ingress: delegates signature-verified persistence to the unchanged
-- Phase 5A RPC, then creates test-customer history in the SAME transaction.
CREATE FUNCTION public.ingest_whatsapp_ai_test_message(p_phone_number_id text, p_waba_id text, p_meta_message_id text, p_message_type text, p_body text, p_meta_timestamp timestamptz, p_sender_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_result text; v_connection public.whatsapp_connections%ROWTYPE; v_conversation uuid; v_message uuid; v_position integer;
BEGIN
    v_result := public.ingest_whatsapp_test_message(p_phone_number_id, p_waba_id, p_meta_message_id, p_message_type, p_body, p_meta_timestamp);
    IF v_result <> 'inserted' OR p_message_type <> 'text' OR p_sender_id IS NULL THEN RETURN v_result; END IF;
    IF p_sender_id !~ '^[0-9]{5,32}$' THEN RAISE EXCEPTION 'Invalid test sender' USING ERRCODE = '22023'; END IF;
    SELECT * INTO STRICT v_connection FROM public.whatsapp_connections WHERE phone_number_id = p_phone_number_id AND waba_id = p_waba_id AND is_test AND status = 'active' FOR SHARE;
    INSERT INTO public.ai_conversations(workspace_id, channel, connection_id, customer_wa_id, title)
    VALUES (v_connection.workspace_id, 'whatsapp_test', v_connection.id, p_sender_id, 'Test customer · ' || pg_catalog.right(p_sender_id, 4))
    ON CONFLICT (connection_id, customer_wa_id) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_conversation;
    SELECT id INTO STRICT v_message FROM public.whatsapp_inbound_messages WHERE meta_message_id = p_meta_message_id AND workspace_id = v_connection.workspace_id;
    SELECT COALESCE(max(position), 0) + 1 INTO v_position FROM public.ai_messages WHERE conversation_id = v_conversation;
    INSERT INTO public.ai_messages(workspace_id, conversation_id, position, role, content, provider, inbound_message_id)
    VALUES (v_connection.workspace_id, v_conversation, v_position, 'user', p_body, 'customer', v_message);
    UPDATE public.ai_conversations SET revision = revision + 1, updated_at = now() WHERE id = v_conversation;
    RETURN v_result;
END;
$function$;

ALTER FUNCTION public.save_ai_agent_settings(uuid,text,text,text,text,text,boolean) OWNER TO postgres;
ALTER FUNCTION public.reserve_ai_preview(uuid) OWNER TO postgres;
ALTER FUNCTION public.create_ai_playground(uuid) OWNER TO postgres;
ALTER FUNCTION public.save_ai_turn(uuid,uuid,integer,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.set_ai_conversation_status(uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamptz,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_ai_agent_settings(uuid,text,text,text,text,text,boolean), public.reserve_ai_preview(uuid), public.create_ai_playground(uuid), public.save_ai_turn(uuid,uuid,integer,text,text,text), public.set_ai_conversation_status(uuid,uuid,text), public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamptz,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_ai_agent_settings(uuid,text,text,text,text,text,boolean), public.reserve_ai_preview(uuid), public.create_ai_playground(uuid), public.save_ai_turn(uuid,uuid,integer,text,text,text), public.set_ai_conversation_status(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_whatsapp_ai_test_message(text,text,text,text,text,timestamptz,text) TO service_role;
COMMIT;

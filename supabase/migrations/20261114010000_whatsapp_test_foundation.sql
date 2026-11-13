-- REVIEW ONLY: apply separately after the existing workspace migration.
-- No Meta credentials are stored here. Only administrator-provisioned TEST
-- numbers are supported; workspace clients cannot claim or reassign numbers.
BEGIN;

CREATE TABLE public.whatsapp_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
    phone_number_id text NOT NULL UNIQUE CHECK (phone_number_id ~ '^[0-9]{1,32}$'),
    waba_id text NOT NULL CHECK (waba_id ~ '^[0-9]{1,32}$'),
    is_test boolean NOT NULL DEFAULT true CHECK (is_test = true),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id)
);
CREATE INDEX whatsapp_connections_workspace_idx
    ON public.whatsapp_connections(workspace_id);

CREATE TABLE public.whatsapp_inbound_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    meta_message_id text NOT NULL UNIQUE CHECK (char_length(meta_message_id) BETWEEN 1 AND 512),
    message_type text NOT NULL CHECK (message_type IN ('text', 'unsupported')),
    body text CHECK (char_length(body) <= 4096),
    meta_timestamp timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, connection_id)
        REFERENCES public.whatsapp_connections(workspace_id, id) ON DELETE RESTRICT,
    CHECK ((message_type = 'text' AND body IS NOT NULL)
        OR (message_type = 'unsupported' AND body IS NULL))
);
CREATE INDEX whatsapp_inbound_workspace_received_idx
    ON public.whatsapp_inbound_messages(workspace_id, received_at DESC, id);
CREATE INDEX whatsapp_inbound_connection_idx
    ON public.whatsapp_inbound_messages(workspace_id, connection_id);

ALTER TABLE public.whatsapp_connections OWNER TO postgres;
ALTER TABLE public.whatsapp_inbound_messages OWNER TO postgres;
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_inbound_messages ENABLE ROW LEVEL SECURITY;

-- Includes non-DML privileges inherited from Supabase default ACLs.
-- The webhook credential gets RPC execution only, NOT direct table privileges.
REVOKE ALL ON TABLE public.whatsapp_connections, public.whatsapp_inbound_messages
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.whatsapp_connections, public.whatsapp_inbound_messages
    TO authenticated;

CREATE POLICY whatsapp_connections_member_select ON public.whatsapp_connections
    FOR SELECT TO authenticated
    USING (workspace_private.is_workspace_member(workspace_id));
CREATE POLICY whatsapp_inbound_member_select ON public.whatsapp_inbound_messages
    FOR SELECT TO authenticated
    USING (workspace_private.is_workspace_member(workspace_id));

-- Called ONLY after application-level signature and test-number verification.
-- No workspace ID argument: the administrator-controlled mapping is authoritative.
-- Concurrent retries are deduplicated atomically by the global Meta ID constraint.
CREATE FUNCTION public.ingest_whatsapp_test_message(
    p_phone_number_id text,
    p_waba_id text,
    p_meta_message_id text,
    p_message_type text,
    p_body text,
    p_meta_timestamp timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    connection public.whatsapp_connections%ROWTYPE;
    inserted_id uuid;
BEGIN
    SELECT c.* INTO connection
    FROM public.whatsapp_connections AS c
    WHERE c.phone_number_id = p_phone_number_id
      AND c.waba_id = p_waba_id
      AND c.is_test = true AND c.status = 'active'
    FOR SHARE;

    IF NOT FOUND THEN
        RETURN 'ignored';
    END IF;

    INSERT INTO public.whatsapp_inbound_messages (
        workspace_id, connection_id, meta_message_id, message_type, body, meta_timestamp
    ) VALUES (
        connection.workspace_id, connection.id, p_meta_message_id,
        p_message_type, p_body, p_meta_timestamp
    )
    ON CONFLICT (meta_message_id) DO NOTHING
    RETURNING id INTO inserted_id;

    IF inserted_id IS NULL THEN RETURN 'duplicate'; END IF;
    RETURN 'inserted';
END;
$function$;

ALTER FUNCTION public.ingest_whatsapp_test_message(text, text, text, text, text, timestamptz)
    OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ingest_whatsapp_test_message(text, text, text, text, text, timestamptz)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ingest_whatsapp_test_message(text, text, text, text, text, timestamptz)
    TO service_role;

COMMIT;

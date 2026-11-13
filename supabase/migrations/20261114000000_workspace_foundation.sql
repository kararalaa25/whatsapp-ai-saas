-- Unapplied foundation migration. Requires the Supabase migration administrator.
BEGIN;

-- Keep the RLS helper outside exposed application schemas. Do not add this
-- schema to Supabase's exposed schemas; it contains no client-write interface.
CREATE SCHEMA workspace_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA workspace_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA workspace_private TO authenticated;

CREATE TABLE public.workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workspaces_name_valid CHECK (
        name = pg_catalog.btrim(name)
        AND pg_catalog.char_length(name) BETWEEN 1 AND 120
    )
);

CREATE TABLE public.workspace_members (
    workspace_id uuid NOT NULL
        REFERENCES public.workspaces (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE public.workspaces OWNER TO postgres;
ALTER TABLE public.workspace_members OWNER TO postgres;

CREATE INDEX workspace_members_user_workspace_idx
    ON public.workspace_members (user_id, workspace_id);

-- Enforces at most one owner. Atomic RPC creation and denied client mutations
-- enforce at least one owner for every currently supported operation.
CREATE UNIQUE INDEX workspace_members_one_owner_idx
    ON public.workspace_members (workspace_id)
    WHERE role = 'owner';

CREATE INDEX workspaces_created_by_idx ON public.workspaces (created_by);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- Revoke inherited/default table privileges, including TRUNCATE and REFERENCES.
-- No client INSERT/UPDATE/DELETE policies or grants are created.
REVOKE ALL ON TABLE public.workspaces, public.workspace_members
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workspaces, public.workspace_members
    TO authenticated;

-- A narrowly scoped definer avoids recursively evaluating membership RLS.
-- It can answer only whether the calling user belongs to the supplied workspace.
-- postgres owns these tables and intentionally bypasses their RLS here;
-- FORCE ROW LEVEL SECURITY is deliberately not enabled.
CREATE FUNCTION workspace_private.is_workspace_member(target_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members AS membership
        WHERE membership.workspace_id = target_workspace_id
          AND membership.user_id = (SELECT auth.uid())
    );
$function$;

ALTER FUNCTION workspace_private.is_workspace_member(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION workspace_private.is_workspace_member(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION workspace_private.is_workspace_member(uuid)
    TO authenticated;

CREATE POLICY workspaces_member_select
    ON public.workspaces
    FOR SELECT TO authenticated
    USING (workspace_private.is_workspace_member(id));

CREATE POLICY workspace_members_roster_select
    ON public.workspace_members
    FOR SELECT TO authenticated
    USING (workspace_private.is_workspace_member(workspace_id));

-- Sole client-write entry point. Identity and initial role are never arguments.
-- Both inserts execute in the calling transaction: any error rolls back both.
CREATE FUNCTION public.create_workspace(name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    caller_id uuid := auth.uid();
    workspace_name text := pg_catalog.btrim($1);
    new_workspace_id uuid;
BEGIN
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
    END IF;

    IF workspace_name IS NULL
       OR pg_catalog.char_length(workspace_name) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'Workspace name must contain 1 to 120 characters'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.workspaces (name, created_by)
    VALUES (workspace_name, caller_id)
    RETURNING id INTO new_workspace_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (new_workspace_id, caller_id, 'owner');

    RETURN new_workspace_id;
END;
$function$;

ALTER FUNCTION public.create_workspace(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_workspace(text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_workspace(text) TO authenticated;

-- Owner transfer, membership changes, invitations, and deletion are intentionally
-- unsupported. Privileged database administrators remain a trusted boundary.
COMMIT;

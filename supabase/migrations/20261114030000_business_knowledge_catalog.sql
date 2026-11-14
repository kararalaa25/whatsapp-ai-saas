-- UNAPPLIED Phase 6A. Requires Phase 4 and Phase 5B owner helper.
-- No seed rows, existing migration edits, outbound sending, or external calls.
BEGIN;

CREATE TABLE public.business_products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (name = btrim(name) AND name ~ '[^[:space:]]' AND char_length(name) BETWEEN 1 AND 160),
    description text NOT NULL CHECK (description = btrim(description) AND char_length(description) <= 3000),
    category text NOT NULL CHECK (category = btrim(category) AND char_length(category) <= 100),
    price numeric CHECK (price >= 0 AND price <= 999999999999.99 AND price = round(price, 2)),
    currency text NOT NULL DEFAULT 'IQD' CHECK (currency IN ('IQD','USD','EUR','GBP','SAR','AED','KWD','JOD','TRY')),
    stock_status text NOT NULL DEFAULT 'unknown' CHECK (stock_status IN ('unknown','in_stock','out_of_stock','preorder')),
    sku text NOT NULL CHECK (sku = btrim(sku) AND char_length(sku) <= 80),
    active boolean NOT NULL DEFAULT true,
    image_url text NOT NULL DEFAULT '' CHECK (char_length(image_url) <= 2048 AND
        (image_url = '' OR (image_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}([/?#][^[:space:]<>"''\\]*)?$'
        AND image_url !~* '^https://([^/?#]*\.)?(localhost|local|internal|test|invalid)([/?#]|$)'))),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX business_products_workspace_sku_idx ON public.business_products(workspace_id, lower(sku)) WHERE sku <> '';
CREATE INDEX business_products_workspace_category_idx ON public.business_products(workspace_id, category, id);

CREATE TABLE public.business_faqs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
    question text NOT NULL CHECK (question = btrim(question) AND question ~ '[^[:space:]]' AND char_length(question) BETWEEN 1 AND 300),
    answer text NOT NULL CHECK (answer = btrim(answer) AND answer ~ '[^[:space:]]' AND char_length(answer) BETWEEN 1 AND 3000),
    active boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id)
);
CREATE TABLE public.business_information (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
    topic text NOT NULL CHECK (topic IN ('opening_hours','delivery','payment_methods','returns','general')),
    content text NOT NULL CHECK (content = btrim(content) AND content ~ '[^[:space:]]' AND char_length(content) BETWEEN 1 AND 4000),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, topic)
);

ALTER TABLE public.business_products OWNER TO postgres;
ALTER TABLE public.business_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_products FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.business_products TO authenticated;
CREATE POLICY business_products_owner_read ON public.business_products FOR SELECT TO authenticated
    USING (workspace_private.is_workspace_owner(workspace_id));

ALTER TABLE public.business_faqs OWNER TO postgres;
ALTER TABLE public.business_faqs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_faqs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.business_faqs TO authenticated;
CREATE POLICY business_faqs_owner_read ON public.business_faqs FOR SELECT TO authenticated
    USING (workspace_private.is_workspace_owner(workspace_id));

ALTER TABLE public.business_information OWNER TO postgres;
ALTER TABLE public.business_information ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_information FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.business_information TO authenticated;
CREATE POLICY business_information_owner_read ON public.business_information FOR SELECT TO authenticated
    USING (workspace_private.is_workspace_owner(workspace_id));

-- Fixed branches, full-replacement allowlisted payloads, no caller-supplied
-- workspace/identity fields, no dynamic SQL. Owner checks are inside the RPC.
CREATE FUNCTION public.save_business_knowledge(p_workspace_id uuid, p_kind text, p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
    v_id uuid;
    v_product public.business_products%ROWTYPE;
    v_faq public.business_faqs%ROWTYPE;
    v_information public.business_information%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR NOT workspace_private.is_workspace_owner(p_workspace_id) THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
    -- Serialize capped inserts and changes against supported workspace mutations.
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF NOT FOUND OR NOT workspace_private.is_workspace_owner(p_workspace_id) THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
    IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' OR octet_length(p_data::text) > 40000 THEN
        RAISE EXCEPTION 'Invalid payload' USING ERRCODE = '22023';
    END IF;
    IF p_kind = 'product' THEN
        IF NOT (p_data ?& ARRAY['name','description','category','price','currency','stock_status','sku','active','image_url']) OR p_data - ARRAY['name','description','category','price','currency','stock_status','sku','active','image_url'] <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Invalid fields' USING ERRCODE = '22023';
        END IF;
        IF jsonb_typeof(p_data -> 'name') NOT IN ('string') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        IF jsonb_typeof(p_data -> 'description') NOT IN ('string') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        IF jsonb_typeof(p_data -> 'category') NOT IN ('string') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        IF jsonb_typeof(p_data -> 'price') NOT IN ('number','null') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        IF jsonb_typeof(p_data -> 'currency') NOT IN ('string') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        IF jsonb_typeof(p_data -> 'stock_status') NOT IN ('string') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        IF jsonb_typeof(p_data -> 'sku') NOT IN ('string') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        IF jsonb_typeof(p_data -> 'active') NOT IN ('boolean') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        IF jsonb_typeof(p_data -> 'image_url') NOT IN ('string') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        SELECT * INTO v_product FROM jsonb_populate_record(NULL::public.business_products, p_data);
        IF p_id IS NULL THEN
            IF (SELECT count(*) FROM public.business_products WHERE workspace_id = p_workspace_id) >= 500 THEN
                RAISE EXCEPTION 'Workspace knowledge limit reached' USING ERRCODE = '54000';
            END IF;
            INSERT INTO public.business_products(workspace_id, name, description, category, price, currency, stock_status, sku, active, image_url)
            VALUES (p_workspace_id, v_product.name, v_product.description, v_product.category, v_product.price, v_product.currency, v_product.stock_status, v_product.sku, v_product.active, v_product.image_url) RETURNING id INTO v_id;
        ELSE
            UPDATE public.business_products SET name = v_product.name, description = v_product.description, category = v_product.category, price = v_product.price, currency = v_product.currency, stock_status = v_product.stock_status, sku = v_product.sku, active = v_product.active, image_url = v_product.image_url, updated_at = now()
            WHERE workspace_id = p_workspace_id AND id = p_id RETURNING id INTO v_id;
        END IF;
    ELSIF p_kind = 'faq' THEN
        IF NOT (p_data ?& ARRAY['question','answer','active']) OR p_data - ARRAY['question','answer','active'] <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Invalid fields' USING ERRCODE = '22023';
        END IF;
        IF jsonb_typeof(p_data -> 'question') NOT IN ('string') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        IF jsonb_typeof(p_data -> 'answer') NOT IN ('string') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        IF jsonb_typeof(p_data -> 'active') NOT IN ('boolean') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        SELECT * INTO v_faq FROM jsonb_populate_record(NULL::public.business_faqs, p_data);
        IF p_id IS NULL THEN
            IF (SELECT count(*) FROM public.business_faqs WHERE workspace_id = p_workspace_id) >= 200 THEN
                RAISE EXCEPTION 'Workspace knowledge limit reached' USING ERRCODE = '54000';
            END IF;
            INSERT INTO public.business_faqs(workspace_id, question, answer, active)
            VALUES (p_workspace_id, v_faq.question, v_faq.answer, v_faq.active) RETURNING id INTO v_id;
        ELSE
            UPDATE public.business_faqs SET question = v_faq.question, answer = v_faq.answer, active = v_faq.active, updated_at = now()
            WHERE workspace_id = p_workspace_id AND id = p_id RETURNING id INTO v_id;
        END IF;
    ELSIF p_kind = 'information' THEN
        IF NOT (p_data ?& ARRAY['topic','content']) OR p_data - ARRAY['topic','content'] <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Invalid fields' USING ERRCODE = '22023';
        END IF;
        IF jsonb_typeof(p_data -> 'topic') NOT IN ('string') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        IF jsonb_typeof(p_data -> 'content') NOT IN ('string') THEN RAISE EXCEPTION 'Invalid field type' USING ERRCODE = '22023'; END IF;
        SELECT * INTO v_information FROM jsonb_populate_record(NULL::public.business_information, p_data);
        IF p_id IS NULL THEN
            IF (SELECT count(*) FROM public.business_information WHERE workspace_id = p_workspace_id) >= 5 THEN
                RAISE EXCEPTION 'Workspace knowledge limit reached' USING ERRCODE = '54000';
            END IF;
            INSERT INTO public.business_information(workspace_id, topic, content)
            VALUES (p_workspace_id, v_information.topic, v_information.content) RETURNING id INTO v_id;
        ELSE
            UPDATE public.business_information SET topic = v_information.topic, content = v_information.content, updated_at = now()
            WHERE workspace_id = p_workspace_id AND id = p_id RETURNING id INTO v_id;
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid kind' USING ERRCODE = '22023';
    END IF;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Item unavailable' USING ERRCODE = '42501'; END IF;
    RETURN v_id;
END;
$function$;

CREATE FUNCTION public.delete_business_knowledge(p_workspace_id uuid, p_kind text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
    IF auth.uid() IS NULL OR NOT workspace_private.is_workspace_owner(p_workspace_id) THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF NOT FOUND OR NOT workspace_private.is_workspace_owner(p_workspace_id) THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
    IF p_kind = 'product' THEN
        DELETE FROM public.business_products WHERE workspace_id = p_workspace_id AND id = p_id;
    ELSIF p_kind = 'faq' THEN
        DELETE FROM public.business_faqs WHERE workspace_id = p_workspace_id AND id = p_id;
    ELSIF p_kind = 'information' THEN
        DELETE FROM public.business_information WHERE workspace_id = p_workspace_id AND id = p_id;
    ELSE
        RAISE EXCEPTION 'Invalid kind' USING ERRCODE = '22023';
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item unavailable' USING ERRCODE = '42501'; END IF;
END;
$function$;

ALTER FUNCTION public.save_business_knowledge(uuid,text,uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.delete_business_knowledge(uuid,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_business_knowledge(uuid,text,uuid,jsonb), public.delete_business_knowledge(uuid,text,uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_business_knowledge(uuid,text,uuid,jsonb), public.delete_business_knowledge(uuid,text,uuid) TO authenticated;
COMMIT;

-- SEC-180 — Privacy & Retention Center.
-- Aplicar DEV -> STAGE. PROD permanece fora desta fase.
-- Esta migration cria governança e workflow; NÃO executa exclusão automática de dados.
-- Prazos, bases legais e políticas definitivas exigem validação jurídica/DPO.

CREATE TABLE IF NOT EXISTS public.data_retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  data_class text NOT NULL,
  retention_days integer NOT NULL,
  label text NOT NULL,
  rationale text,
  legal_review_reference text,
  policy_status text NOT NULL DEFAULT 'draft',
  automated_deletion_enabled boolean NOT NULL DEFAULT false,
  legal_review_required boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES public.app_users(id),
  approved_by_user_id uuid REFERENCES public.app_users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_data_class_allowed CHECK (data_class IN (
    'identity_access','security_events','incidents','evidence','recordings','telemetry',
    'audit','support','assets','insurance','consents','community'
  )),
  CONSTRAINT retention_days_range CHECK (retention_days BETWEEN 1 AND 36500),
  CONSTRAINT retention_label_length CHECK (length(trim(label)) BETWEEN 3 AND 160),
  CONSTRAINT retention_rationale_length CHECK (rationale IS NULL OR length(rationale) <= 2000),
  CONSTRAINT retention_legal_reference_length CHECK (legal_review_reference IS NULL OR length(legal_review_reference) <= 500),
  CONSTRAINT retention_status_allowed CHECK (policy_status IN ('draft','approved','retired')),
  CONSTRAINT retention_no_automatic_deletion CHECK (automated_deletion_enabled = false),
  CONSTRAINT retention_legal_review_required CHECK (legal_review_required = true),
  CONSTRAINT retention_approval_requires_reference CHECK (
    policy_status <> 'approved'
    OR (legal_review_reference IS NOT NULL AND length(trim(legal_review_reference)) >= 3 AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  ),
  UNIQUE (organization_id, data_class)
);

CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  property_id uuid REFERENCES public.properties(id),
  requester_user_id uuid NOT NULL REFERENCES public.app_users(id),
  request_type text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  request_text text NOT NULL,
  response_summary text,
  internal_reference text,
  automated_execution_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT privacy_request_type_allowed CHECK (request_type IN ('access','correction','export','restriction','deletion','objection')),
  CONSTRAINT privacy_request_status_allowed CHECK (status IN ('received','under_review','approved','partially_approved','rejected','fulfilled','cancelled')),
  CONSTRAINT privacy_request_text_length CHECK (length(trim(request_text)) BETWEEN 3 AND 5000),
  CONSTRAINT privacy_response_summary_length CHECK (response_summary IS NULL OR length(response_summary) <= 5000),
  CONSTRAINT privacy_internal_reference_length CHECK (internal_reference IS NULL OR length(internal_reference) <= 500),
  CONSTRAINT privacy_no_automatic_execution CHECK (automated_execution_enabled = false)
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_org_status
  ON public.privacy_requests(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_requester
  ON public.privacy_requests(requester_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_property
  ON public.privacy_requests(property_id,created_at DESC) WHERE property_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.privacy_request_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.privacy_requests(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES public.app_users(id),
  action text NOT NULL,
  note text,
  from_status text,
  to_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT privacy_action_allowed CHECK (action IN ('created','status_changed','note_added','cancelled')),
  CONSTRAINT privacy_action_note_length CHECK (note IS NULL OR length(note) <= 3000)
);

CREATE INDEX IF NOT EXISTS idx_privacy_actions_request_time
  ON public.privacy_request_actions(request_id,created_at,id);

ALTER TABLE public.data_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_request_actions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.app_can_manage_privacy_org(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.app_is_platform_admin()
    OR public.app_has_org_role(p_organization_id, ARRAY['admin_organization'])
$$;

CREATE OR REPLACE FUNCTION public.set_data_retention_policy(
  p_organization_id uuid,
  p_data_class text,
  p_retention_days integer,
  p_label text,
  p_rationale text DEFAULT NULL,
  p_policy_status text DEFAULT 'draft',
  p_legal_review_reference text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_id uuid;
  v_data_class text := lower(trim(p_data_class));
  v_status text := lower(trim(p_policy_status));
  v_label text := trim(COALESCE(p_label,''));
  v_rationale text := NULLIF(trim(p_rationale),'');
  v_legal_reference text := NULLIF(trim(p_legal_review_reference),'');
BEGIN
  IF NOT public.app_can_manage_privacy_org(p_organization_id) THEN
    RAISE EXCEPTION 'privacy_policy_management_not_allowed';
  END IF;
  IF v_data_class NOT IN ('identity_access','security_events','incidents','evidence','recordings','telemetry','audit','support','assets','insurance','consents','community') THEN
    RAISE EXCEPTION 'retention_data_class_not_allowed';
  END IF;
  IF p_retention_days IS NULL OR p_retention_days < 1 OR p_retention_days > 36500 THEN
    RAISE EXCEPTION 'invalid_retention_days';
  END IF;
  IF length(v_label) < 3 OR length(v_label) > 160 THEN
    RAISE EXCEPTION 'invalid_retention_label';
  END IF;
  IF v_rationale IS NOT NULL AND length(v_rationale) > 2000 THEN
    RAISE EXCEPTION 'retention_rationale_too_long';
  END IF;
  IF v_status NOT IN ('draft','approved','retired') THEN
    RAISE EXCEPTION 'retention_status_not_allowed';
  END IF;
  IF v_status='approved' AND (v_legal_reference IS NULL OR length(v_legal_reference)<3 OR length(v_legal_reference)>500) THEN
    RAISE EXCEPTION 'legal_review_reference_required';
  END IF;

  v_actor := CASE WHEN public.app_is_platform_admin() THEN public.app_ensure_platform_user() ELSE public.app_current_user_id() END;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  INSERT INTO public.data_retention_policies(
    organization_id,data_class,retention_days,label,rationale,legal_review_reference,policy_status,
    automated_deletion_enabled,legal_review_required,created_by_user_id,approved_by_user_id,approved_at
  ) VALUES (
    p_organization_id,v_data_class,p_retention_days,v_label,v_rationale,v_legal_reference,v_status,
    false,true,v_actor,CASE WHEN v_status='approved' THEN v_actor ELSE NULL END,CASE WHEN v_status='approved' THEN now() ELSE NULL END
  )
  ON CONFLICT (organization_id,data_class) DO UPDATE
  SET retention_days=EXCLUDED.retention_days,
      label=EXCLUDED.label,
      rationale=EXCLUDED.rationale,
      legal_review_reference=EXCLUDED.legal_review_reference,
      policy_status=EXCLUDED.policy_status,
      automated_deletion_enabled=false,
      legal_review_required=true,
      approved_by_user_id=CASE WHEN EXCLUDED.policy_status='approved' THEN v_actor ELSE NULL END,
      approved_at=CASE WHEN EXCLUDED.policy_status='approved' THEN now() ELSE NULL END,
      updated_at=now()
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES (p_organization_id,v_actor,'privacy.retention_policy.updated','data_retention_policy',v_id::text,
    jsonb_build_object('data_class',v_data_class,'retention_days',p_retention_days,'policy_status',v_status,
      'automated_deletion_enabled',false,'legal_review_required',true));

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.list_data_retention_policies(p_organization_id uuid)
RETURNS TABLE(
  id uuid,
  organization_id uuid,
  data_class text,
  retention_days integer,
  label text,
  rationale text,
  legal_review_reference text,
  policy_status text,
  automated_deletion_enabled boolean,
  legal_review_required boolean,
  approved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT p.id,p.organization_id,p.data_class,p.retention_days,p.label,p.rationale,
         p.legal_review_reference,p.policy_status,false,true,p.approved_at,p.created_at,p.updated_at
  FROM public.data_retention_policies p
  WHERE p.organization_id=p_organization_id
    AND public.app_has_org_membership(p.organization_id)
  ORDER BY p.data_class
$$;

CREATE OR REPLACE FUNCTION public.create_my_privacy_request(
  p_organization_id uuid,
  p_property_id uuid,
  p_request_type text,
  p_request_text text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_type text := lower(trim(p_request_type));
  v_text text := trim(COALESCE(p_request_text,''));
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.app_has_org_membership(p_organization_id) THEN RAISE EXCEPTION 'privacy_org_access_denied'; END IF;
  IF p_property_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.id=p_property_id AND p.organization_id=p_organization_id) THEN
      RAISE EXCEPTION 'privacy_property_scope_mismatch';
    END IF;
    IF NOT public.app_has_scope_access(p_organization_id,NULL,p_property_id) THEN
      RAISE EXCEPTION 'privacy_property_access_denied';
    END IF;
  END IF;
  IF v_type NOT IN ('access','correction','export','restriction','deletion','objection') THEN
    RAISE EXCEPTION 'privacy_request_type_not_allowed';
  END IF;
  IF length(v_text)<3 OR length(v_text)>5000 THEN RAISE EXCEPTION 'invalid_privacy_request_text'; END IF;

  INSERT INTO public.privacy_requests(
    organization_id,property_id,requester_user_id,request_type,status,request_text,automated_execution_enabled
  ) VALUES (p_organization_id,p_property_id,v_actor,v_type,'received',v_text,false)
  RETURNING id INTO v_id;

  INSERT INTO public.privacy_request_actions(request_id,actor_user_id,action,note)
  VALUES(v_id,v_actor,'created',NULL);

  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(p_organization_id,v_actor,'privacy.request.created','privacy_request',v_id::text,
    jsonb_build_object('request_type',v_type,'property_id',p_property_id,'automated_execution_enabled',false));

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.list_my_privacy_requests(p_organization_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  organization_id uuid,
  organization_name text,
  property_id uuid,
  property_name text,
  request_type text,
  status text,
  request_text text,
  response_summary text,
  internal_reference text,
  automated_execution_enabled boolean,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT r.id,r.organization_id,o.name,r.property_id,p.name,r.request_type,r.status,r.request_text,
         r.response_summary,r.internal_reference,false,r.created_at,r.updated_at,r.resolved_at
  FROM public.privacy_requests r
  JOIN public.organizations o ON o.id=r.organization_id
  LEFT JOIN public.properties p ON p.id=r.property_id
  WHERE r.requester_user_id=public.app_current_user_id()
    AND (p_organization_id IS NULL OR r.organization_id=p_organization_id)
  ORDER BY r.created_at DESC
  LIMIT 500
$$;

CREATE OR REPLACE FUNCTION public.list_managed_privacy_requests(
  p_organization_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  id uuid,
  organization_id uuid,
  organization_name text,
  property_id uuid,
  property_name text,
  requester_name text,
  request_type text,
  status text,
  request_text text,
  response_summary text,
  internal_reference text,
  automated_execution_enabled boolean,
  deletion_execution_supported boolean,
  legal_hold_review_required boolean,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT r.id,r.organization_id,o.name,r.property_id,p.name,u.full_name,r.request_type,r.status,r.request_text,
         r.response_summary,r.internal_reference,false,false,(r.request_type='deletion'),r.created_at,r.updated_at,r.resolved_at
  FROM public.privacy_requests r
  JOIN public.organizations o ON o.id=r.organization_id
  JOIN public.app_users u ON u.id=r.requester_user_id
  LEFT JOIN public.properties p ON p.id=r.property_id
  WHERE (p_organization_id IS NULL OR r.organization_id=p_organization_id)
    AND (p_status IS NULL OR r.status=p_status)
    AND public.app_can_manage_privacy_org(r.organization_id)
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,200),1),500)
$$;

CREATE OR REPLACE FUNCTION public.update_privacy_request_status(
  p_request_id uuid,
  p_status text,
  p_response_summary text DEFAULT NULL,
  p_internal_reference text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_request public.privacy_requests%ROWTYPE;
  v_actor uuid := public.app_current_user_id();
  v_status text := lower(trim(p_status));
  v_summary text := NULLIF(trim(p_response_summary),'');
  v_reference text := NULLIF(trim(p_internal_reference),'');
BEGIN
  IF v_actor IS NULL AND NOT public.app_is_platform_admin() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_request FROM public.privacy_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy_request_not_found'; END IF;
  IF NOT public.app_can_manage_privacy_org(v_request.organization_id) THEN RAISE EXCEPTION 'privacy_request_management_not_allowed'; END IF;
  IF v_status NOT IN ('received','under_review','approved','partially_approved','rejected','fulfilled','cancelled') THEN
    RAISE EXCEPTION 'privacy_request_status_not_allowed';
  END IF;
  IF v_request.status IN ('fulfilled','cancelled') THEN RAISE EXCEPTION 'privacy_request_terminal'; END IF;
  IF v_status=v_request.status THEN RAISE EXCEPTION 'privacy_request_status_unchanged'; END IF;
  IF v_request.request_type='deletion' AND v_status='fulfilled' THEN
    RAISE EXCEPTION 'privacy_deletion_execution_not_implemented';
  END IF;
  IF v_status IN ('approved','partially_approved','rejected','fulfilled') AND (v_summary IS NULL OR length(v_summary)<3) THEN
    RAISE EXCEPTION 'privacy_response_summary_required';
  END IF;
  IF v_summary IS NOT NULL AND length(v_summary)>5000 THEN RAISE EXCEPTION 'privacy_response_summary_too_long'; END IF;
  IF v_reference IS NOT NULL AND length(v_reference)>500 THEN RAISE EXCEPTION 'privacy_internal_reference_too_long'; END IF;

  IF v_actor IS NULL THEN v_actor:=public.app_ensure_platform_user(); END IF;

  UPDATE public.privacy_requests
  SET status=v_status,
      response_summary=COALESCE(v_summary,response_summary),
      internal_reference=COALESCE(v_reference,internal_reference),
      automated_execution_enabled=false,
      resolved_at=CASE WHEN v_status IN ('rejected','fulfilled','cancelled') THEN now() ELSE NULL END,
      updated_at=now()
  WHERE id=p_request_id;

  INSERT INTO public.privacy_request_actions(request_id,actor_user_id,action,note,from_status,to_status)
  VALUES(p_request_id,v_actor,'status_changed',v_summary,v_request.status,v_status);

  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(v_request.organization_id,v_actor,'privacy.request.status_changed','privacy_request',p_request_id::text,
    jsonb_build_object('request_type',v_request.request_type,'from_status',v_request.status,'to_status',v_status,
      'automated_execution_enabled',false,'deletion_execution_supported',false));

  RETURN p_request_id;
END
$$;

CREATE OR REPLACE FUNCTION public.cancel_my_privacy_request(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_request public.privacy_requests%ROWTYPE;
  v_actor uuid := public.app_current_user_id();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_request FROM public.privacy_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.requester_user_id<>v_actor THEN RAISE EXCEPTION 'privacy_request_not_found'; END IF;
  IF v_request.status NOT IN ('received','under_review') THEN RAISE EXCEPTION 'privacy_request_cannot_cancel'; END IF;

  UPDATE public.privacy_requests
  SET status='cancelled',automated_execution_enabled=false,resolved_at=now(),updated_at=now()
  WHERE id=p_request_id;

  INSERT INTO public.privacy_request_actions(request_id,actor_user_id,action,from_status,to_status)
  VALUES(p_request_id,v_actor,'cancelled',v_request.status,'cancelled');

  RETURN p_request_id;
END
$$;

CREATE OR REPLACE FUNCTION public.get_privacy_request_timeline(p_request_id uuid)
RETURNS TABLE(
  id bigint,
  actor_name text,
  action text,
  note text,
  from_status text,
  to_status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT a.id,u.full_name,a.action,a.note,a.from_status,a.to_status,a.created_at
  FROM public.privacy_request_actions a
  JOIN public.privacy_requests r ON r.id=a.request_id
  LEFT JOIN public.app_users u ON u.id=a.actor_user_id
  WHERE a.request_id=p_request_id
    AND (
      r.requester_user_id=public.app_current_user_id()
      OR public.app_can_manage_privacy_org(r.organization_id)
    )
  ORDER BY a.created_at,a.id
$$;

-- Browser nunca opera as tabelas-base diretamente.
REVOKE ALL ON TABLE public.data_retention_policies FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON TABLE public.privacy_requests FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON TABLE public.privacy_request_actions FROM PUBLIC, anonymous, authenticated;

REVOKE ALL ON FUNCTION public.app_can_manage_privacy_org(uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.set_data_retention_policy(uuid,text,integer,text,text,text,text) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.list_data_retention_policies(uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.create_my_privacy_request(uuid,uuid,text,text) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.list_my_privacy_requests(uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.list_managed_privacy_requests(uuid,text,integer) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.update_privacy_request_status(uuid,text,text,text) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.cancel_my_privacy_request(uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.get_privacy_request_timeline(uuid) FROM PUBLIC, anonymous, authenticated;

GRANT EXECUTE ON FUNCTION public.set_data_retention_policy(uuid,text,integer,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_data_retention_policies(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_my_privacy_request(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_privacy_requests(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_managed_privacy_requests(uuid,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_privacy_request_status(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_my_privacy_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_privacy_request_timeline(uuid) TO authenticated;

COMMENT ON TABLE public.data_retention_policies IS 'Governance records only. automated_deletion_enabled=false is enforced; retention periods require legal/DPO validation and do not override Evidence Vault legal holds.';
COMMENT ON TABLE public.privacy_requests IS 'LGPD/privacy request workflow. No automated data execution/deletion occurs in SEC-180.';
COMMENT ON FUNCTION public.update_privacy_request_status(uuid,text,text,text) IS 'Administrative workflow only. Deletion requests cannot be marked fulfilled while deletion execution is not implemented and legally controlled.';

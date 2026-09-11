-- SEC-179 — suporte e manutenção operacional do iFarm Security.
-- Aplicar DEV -> STAGE. PROD permanece fora desta fase.
-- Targets são operacionais e NÃO constituem SLA contratual nesta fase.

CREATE TABLE IF NOT EXISTS public.support_operational_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  severity public.alert_severity NOT NULL,
  response_minutes integer NOT NULL,
  resolution_minutes integer NOT NULL,
  label text NOT NULL DEFAULT 'Meta operacional',
  contractual boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_target_response_range CHECK (response_minutes BETWEEN 5 AND 10080),
  CONSTRAINT support_target_resolution_range CHECK (resolution_minutes BETWEEN response_minutes AND 43200),
  CONSTRAINT support_target_label_length CHECK (length(trim(label)) BETWEEN 3 AND 120),
  CONSTRAINT support_target_non_contractual CHECK (contractual = false),
  UNIQUE (organization_id, severity)
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  neighborhood_id uuid REFERENCES public.neighborhoods(id),
  property_id uuid REFERENCES public.properties(id),
  device_id uuid REFERENCES public.devices(id),
  opened_by_user_id uuid NOT NULL REFERENCES public.app_users(id),
  assigned_to_user_id uuid REFERENCES public.app_users(id),
  category text NOT NULL,
  severity public.alert_severity NOT NULL,
  status text NOT NULL DEFAULT 'open',
  title text NOT NULL,
  description text NOT NULL,
  response_target_at timestamptz,
  resolution_target_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_ticket_category_allowed CHECK (category IN ('device','connectivity','camera','sensor','gateway','app','access','insurance','other')),
  CONSTRAINT support_ticket_status_allowed CHECK (status IN ('open','triaged','in_progress','waiting_customer','resolved','closed')),
  CONSTRAINT support_ticket_title_length CHECK (length(trim(title)) BETWEEN 3 AND 160),
  CONSTRAINT support_ticket_description_length CHECK (length(trim(description)) BETWEEN 3 AND 5000),
  CONSTRAINT support_ticket_scope_required CHECK (organization_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_org_status
  ON public.support_tickets(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_property
  ON public.support_tickets(property_id,created_at DESC) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_neighborhood
  ON public.support_tickets(neighborhood_id,created_at DESC) WHERE neighborhood_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_device
  ON public.support_tickets(device_id,created_at DESC) WHERE device_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.support_ticket_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES public.app_users(id),
  action text NOT NULL,
  note text,
  from_status text,
  to_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_action_allowed CHECK (action IN ('opened','note_added','status_changed','assigned','target_snapshot')),
  CONSTRAINT support_action_note_length CHECK (note IS NULL OR length(note) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_support_actions_ticket_time
  ON public.support_ticket_actions(ticket_id,created_at DESC);

ALTER TABLE public.support_operational_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_actions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.app_can_manage_support_scope(
  p_organization_id uuid,
  p_neighborhood_id uuid,
  p_property_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    public.app_is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.memberships m
      JOIN public.app_users u ON u.id = m.user_id
      WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
        AND u.status = 'active'
        AND m.status = 'active'
        AND m.organization_id = p_organization_id
        AND m.role = 'admin_organization'
    )
    OR (
      p_property_id IS NULL
      AND p_neighborhood_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.memberships m
        JOIN public.app_users u ON u.id = m.user_id
        WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
          AND u.status = 'active'
          AND m.status = 'active'
          AND m.organization_id = p_organization_id
          AND m.neighborhood_id = p_neighborhood_id
          AND m.property_id IS NULL
          AND m.role IN ('admin_neighborhood','technician')
      )
    )
    OR (
      p_property_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.memberships m
        JOIN public.app_users u ON u.id = m.user_id
        WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
          AND u.status = 'active'
          AND m.status = 'active'
          AND m.organization_id = p_organization_id
          AND m.property_id = p_property_id
          AND m.role IN ('owner','technician')
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.set_support_operational_target(
  p_organization_id uuid,
  p_severity public.alert_severity,
  p_response_minutes integer,
  p_resolution_minutes integer,
  p_label text DEFAULT 'Meta operacional'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_id uuid;
  v_label text := trim(COALESCE(p_label, ''));
BEGIN
  IF NOT (public.app_is_platform_admin() OR public.app_has_org_role(p_organization_id, ARRAY['admin_organization'])) THEN
    RAISE EXCEPTION 'support_target_management_not_allowed';
  END IF;

  IF p_response_minutes IS NULL OR p_response_minutes < 5 OR p_response_minutes > 10080 THEN
    RAISE EXCEPTION 'invalid_response_target';
  END IF;
  IF p_resolution_minutes IS NULL OR p_resolution_minutes < p_response_minutes OR p_resolution_minutes > 43200 THEN
    RAISE EXCEPTION 'invalid_resolution_target';
  END IF;
  IF length(v_label) < 3 OR length(v_label) > 120 THEN
    RAISE EXCEPTION 'invalid_support_target_label';
  END IF;

  v_actor := CASE WHEN public.app_is_platform_admin() THEN public.app_ensure_platform_user() ELSE public.app_current_user_id() END;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  INSERT INTO public.support_operational_targets(
    organization_id,severity,response_minutes,resolution_minutes,label,contractual,active,created_by_user_id
  ) VALUES (
    p_organization_id,p_severity,p_response_minutes,p_resolution_minutes,v_label,false,true,v_actor
  )
  ON CONFLICT (organization_id,severity) DO UPDATE
    SET response_minutes=EXCLUDED.response_minutes,
        resolution_minutes=EXCLUDED.resolution_minutes,
        label=EXCLUDED.label,
        contractual=false,
        active=true,
        updated_at=now()
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES (p_organization_id,v_actor,'support.target.updated','support_operational_target',v_id::text,
    jsonb_build_object('severity',p_severity,'response_minutes',p_response_minutes,'resolution_minutes',p_resolution_minutes,'contractual',false));

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_organization_id uuid,
  p_neighborhood_id uuid,
  p_property_id uuid,
  p_device_id uuid,
  p_category text,
  p_severity public.alert_severity,
  p_title text,
  p_description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_ticket uuid;
  v_org uuid := p_organization_id;
  v_neighborhood uuid := p_neighborhood_id;
  v_property uuid := p_property_id;
  v_device public.devices%ROWTYPE;
  v_target public.support_operational_targets%ROWTYPE;
  v_category text := lower(trim(p_category));
  v_title text := trim(p_title);
  v_description text := trim(p_description);
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  IF p_device_id IS NOT NULL THEN
    SELECT * INTO v_device FROM public.devices WHERE id=p_device_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'support_device_not_found'; END IF;
    IF v_org IS NOT NULL AND v_org IS DISTINCT FROM v_device.organization_id THEN RAISE EXCEPTION 'support_scope_mismatch'; END IF;
    IF v_neighborhood IS NOT NULL AND v_neighborhood IS DISTINCT FROM v_device.neighborhood_id THEN RAISE EXCEPTION 'support_scope_mismatch'; END IF;
    IF v_property IS NOT NULL AND v_property IS DISTINCT FROM v_device.property_id THEN RAISE EXCEPTION 'support_scope_mismatch'; END IF;
    v_org := v_device.organization_id;
    v_neighborhood := v_device.neighborhood_id;
    v_property := v_device.property_id;
  END IF;

  IF v_org IS NULL THEN RAISE EXCEPTION 'support_organization_required'; END IF;
  IF NOT public.app_has_scope_access(v_org,v_neighborhood,v_property) THEN RAISE EXCEPTION 'support_scope_access_denied'; END IF;

  IF v_category NOT IN ('device','connectivity','camera','sensor','gateway','app','access','insurance','other') THEN
    RAISE EXCEPTION 'support_category_not_allowed';
  END IF;
  IF length(v_title) < 3 OR length(v_title) > 160 THEN RAISE EXCEPTION 'invalid_support_title'; END IF;
  IF length(v_description) < 3 OR length(v_description) > 5000 THEN RAISE EXCEPTION 'invalid_support_description'; END IF;

  SELECT * INTO v_target
  FROM public.support_operational_targets
  WHERE organization_id=v_org AND severity=p_severity AND active=true;

  INSERT INTO public.support_tickets(
    organization_id,neighborhood_id,property_id,device_id,opened_by_user_id,category,severity,title,description,
    response_target_at,resolution_target_at
  ) VALUES (
    v_org,v_neighborhood,v_property,p_device_id,v_actor,v_category,p_severity,v_title,v_description,
    CASE WHEN v_target.id IS NULL THEN NULL ELSE now() + make_interval(mins => v_target.response_minutes) END,
    CASE WHEN v_target.id IS NULL THEN NULL ELSE now() + make_interval(mins => v_target.resolution_minutes) END
  ) RETURNING id INTO v_ticket;

  INSERT INTO public.support_ticket_actions(ticket_id,actor_user_id,action,note)
  VALUES (v_ticket,v_actor,'opened',NULL);

  IF v_target.id IS NOT NULL THEN
    INSERT INTO public.support_ticket_actions(ticket_id,actor_user_id,action,note)
    VALUES (v_ticket,v_actor,'target_snapshot',format('%s | resposta %s min | resolução %s min | não contratual',v_target.label,v_target.response_minutes,v_target.resolution_minutes));
  END IF;

  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES (v_org,v_actor,'support.ticket.created','support_ticket',v_ticket::text,
    jsonb_build_object('neighborhood_id',v_neighborhood,'property_id',v_property,'device_id',p_device_id,'category',v_category,'severity',p_severity));

  RETURN v_ticket;
END
$$;

CREATE OR REPLACE FUNCTION public.update_support_ticket_status(
  p_ticket_id uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_actor uuid := public.app_current_user_id();
  v_status text := lower(trim(p_status));
  v_note text := NULLIF(trim(p_note), '');
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'support_ticket_not_found'; END IF;
  IF NOT public.app_can_manage_support_scope(v_ticket.organization_id,v_ticket.neighborhood_id,v_ticket.property_id) THEN
    RAISE EXCEPTION 'support_ticket_management_not_allowed';
  END IF;
  IF v_status NOT IN ('open','triaged','in_progress','waiting_customer','resolved','closed') THEN
    RAISE EXCEPTION 'support_status_not_allowed';
  END IF;
  IF v_ticket.status='closed' THEN RAISE EXCEPTION 'support_ticket_closed_terminal'; END IF;
  IF v_status=v_ticket.status THEN RAISE EXCEPTION 'support_status_unchanged'; END IF;
  IF v_note IS NOT NULL AND length(v_note)>2000 THEN RAISE EXCEPTION 'support_note_too_long'; END IF;

  UPDATE public.support_tickets
  SET status=v_status,
      first_response_at=CASE WHEN first_response_at IS NULL AND v_status<>'open' THEN now() ELSE first_response_at END,
      resolved_at=CASE WHEN v_status='resolved' THEN now() WHEN status='resolved' AND v_status<>'closed' THEN NULL ELSE resolved_at END,
      closed_at=CASE WHEN v_status='closed' THEN now() ELSE closed_at END,
      updated_at=now()
  WHERE id=p_ticket_id;

  INSERT INTO public.support_ticket_actions(ticket_id,actor_user_id,action,note,from_status,to_status)
  VALUES (p_ticket_id,v_actor,'status_changed',v_note,v_ticket.status,v_status);

  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES (v_ticket.organization_id,v_actor,'support.ticket.status_changed','support_ticket',p_ticket_id::text,
    jsonb_build_object('from_status',v_ticket.status,'to_status',v_status,'neighborhood_id',v_ticket.neighborhood_id,'property_id',v_ticket.property_id));

  RETURN p_ticket_id;
END
$$;

CREATE OR REPLACE FUNCTION public.add_support_ticket_note(
  p_ticket_id uuid,
  p_note text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_actor uuid := public.app_current_user_id();
  v_note text := trim(p_note);
  v_id bigint;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id=p_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'support_ticket_not_found'; END IF;
  IF NOT public.app_has_scope_access(v_ticket.organization_id,v_ticket.neighborhood_id,v_ticket.property_id) THEN
    RAISE EXCEPTION 'support_scope_access_denied';
  END IF;
  IF length(v_note)<2 OR length(v_note)>2000 THEN RAISE EXCEPTION 'invalid_support_note'; END IF;

  INSERT INTO public.support_ticket_actions(ticket_id,actor_user_id,action,note)
  VALUES (p_ticket_id,v_actor,'note_added',v_note) RETURNING id INTO v_id;
  UPDATE public.support_tickets SET updated_at=now() WHERE id=p_ticket_id;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.assign_support_ticket(
  p_ticket_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_actor uuid := public.app_current_user_id();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'support_ticket_not_found'; END IF;
  IF NOT public.app_can_manage_support_scope(v_ticket.organization_id,v_ticket.neighborhood_id,v_ticket.property_id) THEN
    RAISE EXCEPTION 'support_ticket_management_not_allowed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m JOIN public.app_users u ON u.id=m.user_id
    WHERE m.user_id=p_user_id AND u.status='active' AND m.status='active'
      AND m.organization_id=v_ticket.organization_id AND m.role='technician'
      AND (
        (v_ticket.property_id IS NOT NULL AND m.property_id=v_ticket.property_id)
        OR (v_ticket.property_id IS NULL AND v_ticket.neighborhood_id IS NOT NULL AND m.neighborhood_id=v_ticket.neighborhood_id AND m.property_id IS NULL)
        OR (v_ticket.property_id IS NULL AND v_ticket.neighborhood_id IS NULL AND m.neighborhood_id IS NULL AND m.property_id IS NULL)
      )
  ) THEN RAISE EXCEPTION 'support_assignee_not_allowed'; END IF;

  UPDATE public.support_tickets SET assigned_to_user_id=p_user_id,updated_at=now() WHERE id=p_ticket_id;
  INSERT INTO public.support_ticket_actions(ticket_id,actor_user_id,action,note)
  VALUES (p_ticket_id,v_actor,'assigned',p_user_id::text);
  RETURN p_ticket_id;
END
$$;

CREATE OR REPLACE FUNCTION public.list_support_tickets(
  p_organization_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  id uuid,
  organization_id uuid,
  organization_name text,
  neighborhood_id uuid,
  neighborhood_name text,
  property_id uuid,
  property_name text,
  device_id uuid,
  device_name text,
  opened_by_name text,
  assigned_to_name text,
  category text,
  severity public.alert_severity,
  status text,
  title text,
  description text,
  response_target_at timestamptz,
  resolution_target_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  response_overdue boolean,
  resolution_overdue boolean,
  target_contractual boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    t.id,t.organization_id,o.name,t.neighborhood_id,n.name,t.property_id,p.name,t.device_id,d.name,
    opener.full_name,assignee.full_name,t.category,t.severity,t.status,t.title,t.description,
    t.response_target_at,t.resolution_target_at,t.first_response_at,t.resolved_at,t.closed_at,
    (t.first_response_at IS NULL AND t.response_target_at IS NOT NULL AND t.response_target_at<now()) AS response_overdue,
    (t.status NOT IN ('resolved','closed') AND t.resolution_target_at IS NOT NULL AND t.resolution_target_at<now()) AS resolution_overdue,
    false AS target_contractual,t.created_at,t.updated_at
  FROM public.support_tickets t
  JOIN public.organizations o ON o.id=t.organization_id
  LEFT JOIN public.neighborhoods n ON n.id=t.neighborhood_id
  LEFT JOIN public.properties p ON p.id=t.property_id
  LEFT JOIN public.devices d ON d.id=t.device_id
  LEFT JOIN public.app_users opener ON opener.id=t.opened_by_user_id
  LEFT JOIN public.app_users assignee ON assignee.id=t.assigned_to_user_id
  WHERE (p_organization_id IS NULL OR t.organization_id=p_organization_id)
    AND (p_status IS NULL OR t.status=p_status)
    AND public.app_has_scope_access(t.organization_id,t.neighborhood_id,t.property_id)
  ORDER BY CASE t.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'attention' THEN 3 ELSE 4 END,
           t.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,200),1),500)
$$;

CREATE OR REPLACE FUNCTION public.get_support_ticket_timeline(p_ticket_id uuid)
RETURNS TABLE(id bigint,actor_name text,action text,note text,from_status text,to_status text,created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT a.id,u.full_name,a.action,a.note,a.from_status,a.to_status,a.created_at
  FROM public.support_ticket_actions a
  JOIN public.support_tickets t ON t.id=a.ticket_id
  LEFT JOIN public.app_users u ON u.id=a.actor_user_id
  WHERE a.ticket_id=p_ticket_id
    AND public.app_has_scope_access(t.organization_id,t.neighborhood_id,t.property_id)
  ORDER BY a.created_at,a.id
$$;

-- Browser nunca opera as tabelas-base diretamente.
REVOKE ALL ON TABLE public.support_operational_targets FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON TABLE public.support_tickets FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON TABLE public.support_ticket_actions FROM PUBLIC, anonymous, authenticated;

REVOKE ALL ON FUNCTION public.app_can_manage_support_scope(uuid,uuid,uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.set_support_operational_target(uuid,public.alert_severity,integer,integer,text) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.create_support_ticket(uuid,uuid,uuid,uuid,text,public.alert_severity,text,text) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.update_support_ticket_status(uuid,text,text) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.add_support_ticket_note(uuid,text) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.assign_support_ticket(uuid,uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.list_support_tickets(uuid,text,integer) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.get_support_ticket_timeline(uuid) FROM PUBLIC, anonymous, authenticated;

GRANT EXECUTE ON FUNCTION public.set_support_operational_target(uuid,public.alert_severity,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(uuid,uuid,uuid,uuid,text,public.alert_severity,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_support_ticket_status(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_support_ticket_note(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_support_ticket(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_support_tickets(uuid,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_ticket_timeline(uuid) TO authenticated;

COMMENT ON TABLE public.support_operational_targets IS 'Operational response/resolution targets only. contractual=false is enforced in MVP and does not create contractual SLA.';
COMMENT ON FUNCTION public.list_support_tickets(uuid,text,integer) IS 'Scoped support queue. target_contractual is always false in MVP.';

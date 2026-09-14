-- SEC-181 — Pilot Readiness & Observability.
-- Aplicar DEV -> STAGE. PROD permanece fora desta fase.
-- O piloto mede operação e viabilidade; não promete prevenção de crimes.
-- Métricas automáticas são derivadas apenas de dados existentes. Métricas manuais são explicitamente marcadas como manuais.

CREATE TABLE IF NOT EXISTS public.pilot_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  neighborhood_id uuid NOT NULL REFERENCES public.neighborhoods(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  target_property_count integer NOT NULL DEFAULT 5,
  planned_start_date date,
  planned_end_date date,
  notes text,
  created_by_user_id uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pilot_name_length CHECK (length(trim(name)) BETWEEN 3 AND 160),
  CONSTRAINT pilot_status_allowed CHECK (status IN ('draft','readiness','active','paused','completed','cancelled')),
  CONSTRAINT pilot_target_property_count CHECK (target_property_count BETWEEN 5 AND 10),
  CONSTRAINT pilot_date_order CHECK (planned_end_date IS NULL OR planned_start_date IS NULL OR planned_end_date >= planned_start_date),
  CONSTRAINT pilot_notes_length CHECK (notes IS NULL OR length(notes) <= 3000)
);

CREATE INDEX IF NOT EXISTS idx_pilot_programs_org_status
  ON public.pilot_programs(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pilot_programs_neighborhood
  ON public.pilot_programs(neighborhood_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.pilot_properties (
  pilot_id uuid NOT NULL REFERENCES public.pilot_programs(id) ON DELETE RESTRICT,
  property_id uuid NOT NULL REFERENCES public.properties(id),
  participation_status text NOT NULL DEFAULT 'invited',
  installation_status text NOT NULL DEFAULT 'pending',
  invited_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  confirmed_by_user_id uuid REFERENCES public.app_users(id),
  installed_at timestamptz,
  validated_at timestamptz,
  notes text,
  PRIMARY KEY (pilot_id,property_id),
  CONSTRAINT pilot_property_participation_allowed CHECK (participation_status IN ('invited','confirmed','declined','removed')),
  CONSTRAINT pilot_property_installation_allowed CHECK (installation_status IN ('pending','scheduled','installed','validated')),
  CONSTRAINT pilot_property_notes_length CHECK (notes IS NULL OR length(notes) <= 2000),
  CONSTRAINT pilot_property_confirmed_consistent CHECK (
    (participation_status='confirmed' AND confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL)
    OR (participation_status<>'confirmed')
  )
);

CREATE INDEX IF NOT EXISTS idx_pilot_properties_property
  ON public.pilot_properties(property_id,pilot_id);
CREATE INDEX IF NOT EXISTS idx_pilot_properties_status
  ON public.pilot_properties(pilot_id,participation_status,installation_status);

CREATE TABLE IF NOT EXISTS public.pilot_system_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pilot_id uuid NOT NULL REFERENCES public.pilot_programs(id) ON DELETE RESTRICT,
  scope_device_count integer NOT NULL,
  online_device_count integer NOT NULL,
  recent_heartbeat_count integer NOT NULL,
  event_count_24h integer NOT NULL,
  validated_event_count_24h integer NOT NULL,
  rejected_event_count_24h integer NOT NULL,
  avg_validation_minutes_24h numeric,
  captured_by_user_id uuid REFERENCES public.app_users(id),
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pilot_snapshot_counts_nonnegative CHECK (
    scope_device_count>=0 AND online_device_count>=0 AND recent_heartbeat_count>=0
    AND event_count_24h>=0 AND validated_event_count_24h>=0 AND rejected_event_count_24h>=0
  ),
  CONSTRAINT pilot_snapshot_device_consistency CHECK (online_device_count<=scope_device_count AND recent_heartbeat_count<=scope_device_count),
  CONSTRAINT pilot_snapshot_event_consistency CHECK (validated_event_count_24h<=event_count_24h AND rejected_event_count_24h<=validated_event_count_24h),
  CONSTRAINT pilot_snapshot_avg_validation CHECK (avg_validation_minutes_24h IS NULL OR avg_validation_minutes_24h>=0)
);

CREATE INDEX IF NOT EXISTS idx_pilot_snapshots_pilot_time
  ON public.pilot_system_snapshots(pilot_id,captured_at DESC);

CREATE TABLE IF NOT EXISTS public.pilot_manual_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pilot_id uuid NOT NULL REFERENCES public.pilot_programs(id) ON DELETE RESTRICT,
  metric_key text NOT NULL,
  metric_value numeric NOT NULL,
  unit text NOT NULL,
  sample_size integer,
  note text,
  source_kind text NOT NULL DEFAULT 'manual',
  recorded_by_user_id uuid REFERENCES public.app_users(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pilot_manual_metric_allowed CHECK (metric_key IN (
    'connectivity_uptime_pct','video_delivery_success_pct','alert_false_positive_pct',
    'installation_minutes_avg','user_experience_score','monthly_operating_cost_brl','mrr_potential_brl'
  )),
  CONSTRAINT pilot_manual_source_only CHECK (source_kind='manual'),
  CONSTRAINT pilot_manual_value_nonnegative CHECK (metric_value>=0),
  CONSTRAINT pilot_manual_percentage_range CHECK (
    metric_key NOT IN ('connectivity_uptime_pct','video_delivery_success_pct','alert_false_positive_pct')
    OR metric_value<=100
  ),
  CONSTRAINT pilot_manual_ux_range CHECK (metric_key<>'user_experience_score' OR (metric_value>=1 AND metric_value<=5)),
  CONSTRAINT pilot_manual_sample_size CHECK (sample_size IS NULL OR sample_size>=1),
  CONSTRAINT pilot_manual_note_length CHECK (note IS NULL OR length(note)<=2000)
);

CREATE INDEX IF NOT EXISTS idx_pilot_manual_observations_pilot_time
  ON public.pilot_manual_observations(pilot_id,observed_at DESC);

ALTER TABLE public.pilot_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_system_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_manual_observations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.app_can_manage_pilot_org(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.app_is_platform_admin()
    OR public.app_has_org_role(p_organization_id, ARRAY['admin_organization'])
$$;

CREATE OR REPLACE FUNCTION public.app_can_view_pilot(p_pilot_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pilot_programs p
    WHERE p.id=p_pilot_id
      AND (
        public.app_can_manage_pilot_org(p.organization_id)
        OR EXISTS (
          SELECT 1
          FROM public.memberships m
          JOIN public.app_users u ON u.id=m.user_id
          WHERE u.auth_user_id=NULLIF(auth.user_id(),'')::uuid
            AND u.status='active'
            AND m.status='active'
            AND m.organization_id=p.organization_id
            AND m.neighborhood_id=p.neighborhood_id
            AND m.property_id IS NULL
            AND m.role IN ('admin_neighborhood','monitoring')
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.create_pilot_program(
  p_organization_id uuid,
  p_neighborhood_id uuid,
  p_name text,
  p_target_property_count integer DEFAULT 5,
  p_planned_start_date date DEFAULT NULL,
  p_planned_end_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_id uuid;
  v_name text := trim(COALESCE(p_name,''));
  v_notes text := NULLIF(trim(p_notes),'');
BEGIN
  IF v_actor IS NULL AND NOT public.app_is_platform_admin() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.app_can_manage_pilot_org(p_organization_id) THEN RAISE EXCEPTION 'pilot_management_not_allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.neighborhoods n WHERE n.id=p_neighborhood_id AND n.organization_id=p_organization_id) THEN
    RAISE EXCEPTION 'pilot_neighborhood_scope_mismatch';
  END IF;
  IF length(v_name)<3 OR length(v_name)>160 THEN RAISE EXCEPTION 'invalid_pilot_name'; END IF;
  IF p_target_property_count IS NULL OR p_target_property_count<5 OR p_target_property_count>10 THEN RAISE EXCEPTION 'pilot_target_must_be_5_to_10'; END IF;
  IF p_planned_end_date IS NOT NULL AND p_planned_start_date IS NOT NULL AND p_planned_end_date<p_planned_start_date THEN
    RAISE EXCEPTION 'pilot_date_order_invalid';
  END IF;
  IF v_notes IS NOT NULL AND length(v_notes)>3000 THEN RAISE EXCEPTION 'pilot_notes_too_long'; END IF;
  IF v_actor IS NULL THEN v_actor:=public.app_ensure_platform_user(); END IF;

  INSERT INTO public.pilot_programs(
    organization_id,neighborhood_id,name,status,target_property_count,planned_start_date,planned_end_date,notes,created_by_user_id
  ) VALUES (
    p_organization_id,p_neighborhood_id,v_name,'draft',p_target_property_count,p_planned_start_date,p_planned_end_date,v_notes,v_actor
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(p_organization_id,v_actor,'pilot.program.created','pilot_program',v_id::text,
    jsonb_build_object('neighborhood_id',p_neighborhood_id,'target_property_count',p_target_property_count));
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.invite_property_to_pilot(
  p_pilot_id uuid,
  p_property_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_pilot public.pilot_programs%ROWTYPE;
  v_actor uuid := public.app_current_user_id();
  v_notes text := NULLIF(trim(p_notes),'');
BEGIN
  IF v_actor IS NULL AND NOT public.app_is_platform_admin() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_pilot FROM public.pilot_programs WHERE id=p_pilot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'pilot_not_found'; END IF;
  IF NOT public.app_can_manage_pilot_org(v_pilot.organization_id) THEN RAISE EXCEPTION 'pilot_management_not_allowed'; END IF;
  IF v_pilot.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'pilot_terminal'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id=p_property_id AND p.organization_id=v_pilot.organization_id AND p.neighborhood_id=v_pilot.neighborhood_id
  ) THEN RAISE EXCEPTION 'pilot_property_scope_mismatch'; END IF;
  IF v_notes IS NOT NULL AND length(v_notes)>2000 THEN RAISE EXCEPTION 'pilot_property_notes_too_long'; END IF;
  IF v_actor IS NULL THEN v_actor:=public.app_ensure_platform_user(); END IF;

  INSERT INTO public.pilot_properties(pilot_id,property_id,participation_status,installation_status,notes)
  VALUES(p_pilot_id,p_property_id,'invited','pending',v_notes)
  ON CONFLICT (pilot_id,property_id) DO UPDATE
    SET participation_status=CASE WHEN public.pilot_properties.participation_status='removed' THEN 'invited' ELSE public.pilot_properties.participation_status END,
        notes=COALESCE(EXCLUDED.notes,public.pilot_properties.notes),
        invited_at=CASE WHEN public.pilot_properties.participation_status='removed' THEN now() ELSE public.pilot_properties.invited_at END;

  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(v_pilot.organization_id,v_actor,'pilot.property.invited','pilot_property',p_property_id::text,
    jsonb_build_object('pilot_id',p_pilot_id,'neighborhood_id',v_pilot.neighborhood_id));
  RETURN p_property_id;
END
$$;

CREATE OR REPLACE FUNCTION public.confirm_my_property_pilot(
  p_pilot_id uuid,
  p_property_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_pilot public.pilot_programs%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_pilot FROM public.pilot_programs WHERE id=p_pilot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'pilot_not_found'; END IF;
  IF v_pilot.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'pilot_terminal'; END IF;
  IF NOT public.app_has_org_role(v_pilot.organization_id,ARRAY['owner']) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id=v_actor AND m.status='active' AND m.organization_id=v_pilot.organization_id
        AND m.property_id=p_property_id AND m.role='owner'
    ) THEN RAISE EXCEPTION 'pilot_owner_confirmation_required'; END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id=v_actor AND m.status='active' AND m.organization_id=v_pilot.organization_id
      AND m.property_id=p_property_id AND m.role='owner'
  ) THEN RAISE EXCEPTION 'pilot_owner_confirmation_required'; END IF;

  UPDATE public.pilot_properties
  SET participation_status='confirmed',confirmed_at=now(),confirmed_by_user_id=v_actor
  WHERE pilot_id=p_pilot_id AND property_id=p_property_id AND participation_status='invited';
  IF NOT FOUND THEN RAISE EXCEPTION 'pilot_invitation_not_found'; END IF;

  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(v_pilot.organization_id,v_actor,'pilot.property.confirmed','pilot_property',p_property_id::text,
    jsonb_build_object('pilot_id',p_pilot_id));
  RETURN p_property_id;
END
$$;

CREATE OR REPLACE FUNCTION public.update_pilot_installation_status(
  p_pilot_id uuid,
  p_property_id uuid,
  p_installation_status text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_pilot public.pilot_programs%ROWTYPE;
  v_actor uuid := public.app_current_user_id();
  v_status text := lower(trim(p_installation_status));
  v_note text := NULLIF(trim(p_note),'');
BEGIN
  IF v_actor IS NULL AND NOT public.app_is_platform_admin() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_pilot FROM public.pilot_programs WHERE id=p_pilot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'pilot_not_found'; END IF;
  IF v_status NOT IN ('pending','scheduled','installed','validated') THEN RAISE EXCEPTION 'pilot_installation_status_not_allowed'; END IF;
  IF v_note IS NOT NULL AND length(v_note)>2000 THEN RAISE EXCEPTION 'pilot_property_notes_too_long'; END IF;

  IF NOT public.app_can_manage_pilot_org(v_pilot.organization_id) AND NOT EXISTS (
    SELECT 1 FROM public.memberships m
    JOIN public.app_users u ON u.id=m.user_id
    WHERE u.auth_user_id=NULLIF(auth.user_id(),'')::uuid AND u.status='active' AND m.status='active'
      AND m.organization_id=v_pilot.organization_id AND m.property_id=p_property_id AND m.role='technician'
  ) THEN RAISE EXCEPTION 'pilot_installation_management_not_allowed'; END IF;
  IF v_actor IS NULL THEN v_actor:=public.app_ensure_platform_user(); END IF;

  UPDATE public.pilot_properties
  SET installation_status=v_status,
      installed_at=CASE WHEN v_status IN ('installed','validated') AND installed_at IS NULL THEN now() ELSE installed_at END,
      validated_at=CASE WHEN v_status='validated' THEN now() ELSE validated_at END,
      notes=COALESCE(v_note,notes)
  WHERE pilot_id=p_pilot_id AND property_id=p_property_id AND participation_status='confirmed';
  IF NOT FOUND THEN RAISE EXCEPTION 'pilot_confirmed_property_not_found'; END IF;
  RETURN p_property_id;
END
$$;

CREATE OR REPLACE FUNCTION public.set_pilot_status(p_pilot_id uuid,p_status text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_pilot public.pilot_programs%ROWTYPE;
  v_actor uuid := public.app_current_user_id();
  v_status text := lower(trim(p_status));
  v_confirmed integer;
BEGIN
  IF v_actor IS NULL AND NOT public.app_is_platform_admin() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_pilot FROM public.pilot_programs WHERE id=p_pilot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pilot_not_found'; END IF;
  IF NOT public.app_can_manage_pilot_org(v_pilot.organization_id) THEN RAISE EXCEPTION 'pilot_management_not_allowed'; END IF;
  IF v_pilot.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'pilot_terminal'; END IF;
  IF v_status NOT IN ('draft','readiness','active','paused','completed','cancelled') THEN RAISE EXCEPTION 'pilot_status_not_allowed'; END IF;
  IF v_status=v_pilot.status THEN RAISE EXCEPTION 'pilot_status_unchanged'; END IF;

  SELECT count(*)::integer INTO v_confirmed
  FROM public.pilot_properties pp
  WHERE pp.pilot_id=p_pilot_id AND pp.participation_status='confirmed';
  IF v_status='active' AND (v_confirmed<5 OR v_confirmed>10) THEN
    RAISE EXCEPTION 'pilot_active_requires_5_to_10_confirmed_properties';
  END IF;
  IF v_status='completed' AND v_pilot.status NOT IN ('active','paused') THEN
    RAISE EXCEPTION 'pilot_completion_requires_active_or_paused';
  END IF;
  IF v_actor IS NULL THEN v_actor:=public.app_ensure_platform_user(); END IF;

  UPDATE public.pilot_programs SET status=v_status,updated_at=now() WHERE id=p_pilot_id;
  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(v_pilot.organization_id,v_actor,'pilot.program.status_changed','pilot_program',p_pilot_id::text,
    jsonb_build_object('from_status',v_pilot.status,'to_status',v_status,'confirmed_properties',v_confirmed));
  RETURN p_pilot_id;
END
$$;

CREATE OR REPLACE FUNCTION public.capture_pilot_system_snapshot(p_pilot_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_pilot public.pilot_programs%ROWTYPE;
  v_actor uuid := public.app_current_user_id();
  v_scope_devices integer;
  v_online integer;
  v_recent integer;
  v_events integer;
  v_validated integer;
  v_rejected integer;
  v_avg_minutes numeric;
  v_id bigint;
BEGIN
  IF v_actor IS NULL AND NOT public.app_is_platform_admin() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_pilot FROM public.pilot_programs WHERE id=p_pilot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'pilot_not_found'; END IF;
  IF NOT public.app_can_manage_pilot_org(v_pilot.organization_id) THEN RAISE EXCEPTION 'pilot_snapshot_management_not_allowed'; END IF;
  IF v_actor IS NULL THEN v_actor:=public.app_ensure_platform_user(); END IF;

  WITH scoped_devices AS (
    SELECT d.* FROM public.devices d
    WHERE d.organization_id=v_pilot.organization_id
      AND (
        (d.neighborhood_id=v_pilot.neighborhood_id AND d.property_id IS NULL AND d.community_shared=true)
        OR d.property_id IN (
          SELECT pp.property_id FROM public.pilot_properties pp
          WHERE pp.pilot_id=p_pilot_id AND pp.participation_status='confirmed'
        )
      )
  )
  SELECT count(*)::integer,
         count(*) FILTER (WHERE status='online')::integer,
         count(*) FILTER (WHERE last_seen_at IS NOT NULL AND last_seen_at >= now() - make_interval(secs=>offline_after_seconds))::integer
  INTO v_scope_devices,v_online,v_recent
  FROM scoped_devices;

  WITH scoped_events AS (
    SELECT e.* FROM public.security_events e
    WHERE e.organization_id=v_pilot.organization_id
      AND e.occurred_at>=now()-interval '24 hours'
      AND (
        (e.neighborhood_id=v_pilot.neighborhood_id AND e.property_id IS NULL)
        OR e.property_id IN (
          SELECT pp.property_id FROM public.pilot_properties pp
          WHERE pp.pilot_id=p_pilot_id AND pp.participation_status='confirmed'
        )
      )
  )
  SELECT count(*)::integer,
         count(*) FILTER (WHERE human_validation_status<>'pending')::integer,
         count(*) FILTER (WHERE human_validation_status='rejected')::integer,
         avg(EXTRACT(EPOCH FROM (validated_at-occurred_at))/60.0) FILTER (WHERE validated_at IS NOT NULL AND validated_at>=occurred_at)
  INTO v_events,v_validated,v_rejected,v_avg_minutes
  FROM scoped_events;

  INSERT INTO public.pilot_system_snapshots(
    pilot_id,scope_device_count,online_device_count,recent_heartbeat_count,event_count_24h,
    validated_event_count_24h,rejected_event_count_24h,avg_validation_minutes_24h,captured_by_user_id
  ) VALUES (
    p_pilot_id,COALESCE(v_scope_devices,0),COALESCE(v_online,0),COALESCE(v_recent,0),COALESCE(v_events,0),
    COALESCE(v_validated,0),COALESCE(v_rejected,0),v_avg_minutes,v_actor
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.record_pilot_manual_observation(
  p_pilot_id uuid,
  p_metric_key text,
  p_metric_value numeric,
  p_unit text,
  p_sample_size integer DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_observed_at timestamptz DEFAULT now()
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_pilot public.pilot_programs%ROWTYPE;
  v_actor uuid := public.app_current_user_id();
  v_key text := lower(trim(p_metric_key));
  v_unit text := trim(COALESCE(p_unit,''));
  v_note text := NULLIF(trim(p_note),'');
  v_id bigint;
BEGIN
  IF v_actor IS NULL AND NOT public.app_is_platform_admin() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_pilot FROM public.pilot_programs WHERE id=p_pilot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'pilot_not_found'; END IF;
  IF NOT public.app_can_manage_pilot_org(v_pilot.organization_id) THEN RAISE EXCEPTION 'pilot_manual_metric_management_not_allowed'; END IF;
  IF v_key NOT IN ('connectivity_uptime_pct','video_delivery_success_pct','alert_false_positive_pct','installation_minutes_avg','user_experience_score','monthly_operating_cost_brl','mrr_potential_brl') THEN
    RAISE EXCEPTION 'pilot_manual_metric_not_allowed';
  END IF;
  IF p_metric_value IS NULL OR p_metric_value<0 THEN RAISE EXCEPTION 'pilot_manual_metric_value_invalid'; END IF;
  IF v_key IN ('connectivity_uptime_pct','video_delivery_success_pct','alert_false_positive_pct') AND p_metric_value>100 THEN RAISE EXCEPTION 'pilot_manual_percentage_out_of_range'; END IF;
  IF v_key='user_experience_score' AND (p_metric_value<1 OR p_metric_value>5) THEN RAISE EXCEPTION 'pilot_user_experience_out_of_range'; END IF;
  IF length(v_unit)<1 OR length(v_unit)>40 THEN RAISE EXCEPTION 'pilot_manual_unit_invalid'; END IF;
  IF p_sample_size IS NOT NULL AND p_sample_size<1 THEN RAISE EXCEPTION 'pilot_sample_size_invalid'; END IF;
  IF v_note IS NOT NULL AND length(v_note)>2000 THEN RAISE EXCEPTION 'pilot_manual_note_too_long'; END IF;
  IF v_actor IS NULL THEN v_actor:=public.app_ensure_platform_user(); END IF;

  INSERT INTO public.pilot_manual_observations(
    pilot_id,metric_key,metric_value,unit,sample_size,note,source_kind,recorded_by_user_id,observed_at
  ) VALUES (p_pilot_id,v_key,p_metric_value,v_unit,p_sample_size,v_note,'manual',v_actor,COALESCE(p_observed_at,now()))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.list_pilot_programs(p_organization_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid,organization_id uuid,organization_name text,neighborhood_id uuid,neighborhood_name text,
  name text,status text,target_property_count integer,confirmed_property_count integer,installed_property_count integer,
  planned_start_date date,planned_end_date date,created_at timestamptz,updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT p.id,p.organization_id,o.name,p.neighborhood_id,n.name,p.name,p.status,p.target_property_count,
         count(pp.property_id) FILTER (WHERE pp.participation_status='confirmed')::integer,
         count(pp.property_id) FILTER (WHERE pp.participation_status='confirmed' AND pp.installation_status IN ('installed','validated'))::integer,
         p.planned_start_date,p.planned_end_date,p.created_at,p.updated_at
  FROM public.pilot_programs p
  JOIN public.organizations o ON o.id=p.organization_id
  JOIN public.neighborhoods n ON n.id=p.neighborhood_id
  LEFT JOIN public.pilot_properties pp ON pp.pilot_id=p.id
  WHERE (p_organization_id IS NULL OR p.organization_id=p_organization_id)
    AND public.app_can_view_pilot(p.id)
  GROUP BY p.id,o.name,n.name
  ORDER BY p.created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.get_pilot_readiness(p_pilot_id uuid)
RETURNS TABLE(
  pilot_id uuid,name text,status text,target_property_count integer,confirmed_property_count integer,
  installed_property_count integer,validated_property_count integer,invited_property_count integer,
  latest_snapshot_at timestamptz,scope_device_count integer,online_device_count integer,recent_heartbeat_count integer,
  device_online_now_pct numeric,recent_heartbeat_pct numeric,event_count_24h integer,validated_event_count_24h integer,
  rejected_event_count_24h integer,event_validation_rate_pct_24h numeric,event_rejection_rate_pct_24h numeric,
  avg_validation_minutes_24h numeric,ready_for_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH p AS (
    SELECT * FROM public.pilot_programs WHERE id=p_pilot_id AND public.app_can_view_pilot(id)
  ), counts AS (
    SELECT pp.pilot_id,
      count(*) FILTER (WHERE pp.participation_status='confirmed')::integer confirmed,
      count(*) FILTER (WHERE pp.participation_status='confirmed' AND pp.installation_status IN ('installed','validated'))::integer installed,
      count(*) FILTER (WHERE pp.participation_status='confirmed' AND pp.installation_status='validated')::integer validated,
      count(*) FILTER (WHERE pp.participation_status='invited')::integer invited
    FROM public.pilot_properties pp WHERE pp.pilot_id=p_pilot_id GROUP BY pp.pilot_id
  ), snap AS (
    SELECT s.* FROM public.pilot_system_snapshots s WHERE s.pilot_id=p_pilot_id ORDER BY s.captured_at DESC LIMIT 1
  )
  SELECT p.id,p.name,p.status,p.target_property_count,COALESCE(c.confirmed,0),COALESCE(c.installed,0),COALESCE(c.validated,0),COALESCE(c.invited,0),
         s.captured_at,COALESCE(s.scope_device_count,0),COALESCE(s.online_device_count,0),COALESCE(s.recent_heartbeat_count,0),
         CASE WHEN COALESCE(s.scope_device_count,0)=0 THEN NULL ELSE round(100.0*s.online_device_count/s.scope_device_count,2) END,
         CASE WHEN COALESCE(s.scope_device_count,0)=0 THEN NULL ELSE round(100.0*s.recent_heartbeat_count/s.scope_device_count,2) END,
         COALESCE(s.event_count_24h,0),COALESCE(s.validated_event_count_24h,0),COALESCE(s.rejected_event_count_24h,0),
         CASE WHEN COALESCE(s.event_count_24h,0)=0 THEN NULL ELSE round(100.0*s.validated_event_count_24h/s.event_count_24h,2) END,
         CASE WHEN COALESCE(s.validated_event_count_24h,0)=0 THEN NULL ELSE round(100.0*s.rejected_event_count_24h/s.validated_event_count_24h,2) END,
         s.avg_validation_minutes_24h,
         (COALESCE(c.confirmed,0) BETWEEN 5 AND 10)
  FROM p LEFT JOIN counts c ON c.pilot_id=p.id LEFT JOIN snap s ON true
$$;

CREATE OR REPLACE FUNCTION public.list_pilot_properties(p_pilot_id uuid)
RETURNS TABLE(
  property_id uuid,property_name text,participation_status text,installation_status text,
  confirmed_at timestamptz,installed_at timestamptz,validated_at timestamptz,notes text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT pp.property_id,p.name,pp.participation_status,pp.installation_status,pp.confirmed_at,pp.installed_at,pp.validated_at,pp.notes
  FROM public.pilot_properties pp
  JOIN public.properties p ON p.id=pp.property_id
  WHERE pp.pilot_id=p_pilot_id AND public.app_can_view_pilot(p_pilot_id)
  ORDER BY p.name
$$;

CREATE OR REPLACE FUNCTION public.list_my_pilot_invitations()
RETURNS TABLE(
  pilot_id uuid,pilot_name text,property_id uuid,property_name text,neighborhood_name text,participation_status text,invited_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT pp.pilot_id,p.name,pp.property_id,pr.name,n.name,pp.participation_status,pp.invited_at
  FROM public.pilot_properties pp
  JOIN public.pilot_programs p ON p.id=pp.pilot_id
  JOIN public.properties pr ON pr.id=pp.property_id
  JOIN public.neighborhoods n ON n.id=p.neighborhood_id
  WHERE EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id=public.app_current_user_id() AND m.status='active' AND m.property_id=pp.property_id AND m.role='owner'
  )
  ORDER BY pp.invited_at DESC
$$;

CREATE OR REPLACE FUNCTION public.list_pilot_manual_observations(p_pilot_id uuid,p_limit integer DEFAULT 100)
RETURNS TABLE(
  id bigint,metric_key text,metric_value numeric,unit text,sample_size integer,note text,source_kind text,observed_at timestamptz,recorded_by_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT o.id,o.metric_key,o.metric_value,o.unit,o.sample_size,o.note,o.source_kind,o.observed_at,u.full_name
  FROM public.pilot_manual_observations o
  LEFT JOIN public.app_users u ON u.id=o.recorded_by_user_id
  WHERE o.pilot_id=p_pilot_id AND public.app_can_view_pilot(p_pilot_id)
  ORDER BY o.observed_at DESC,o.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),500)
$$;

-- Browser nunca opera tabelas-base de piloto diretamente.
REVOKE ALL ON TABLE public.pilot_programs FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON TABLE public.pilot_properties FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON TABLE public.pilot_system_snapshots FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON TABLE public.pilot_manual_observations FROM PUBLIC, anonymous, authenticated;

REVOKE ALL ON FUNCTION public.app_can_manage_pilot_org(uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.app_can_view_pilot(uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.create_pilot_program(uuid,uuid,text,integer,date,date,text) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.invite_property_to_pilot(uuid,uuid,text) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.confirm_my_property_pilot(uuid,uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.update_pilot_installation_status(uuid,uuid,text,text) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.set_pilot_status(uuid,text) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.capture_pilot_system_snapshot(uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.record_pilot_manual_observation(uuid,text,numeric,text,integer,text,timestamptz) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.list_pilot_programs(uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.get_pilot_readiness(uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.list_pilot_properties(uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.list_my_pilot_invitations() FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.list_pilot_manual_observations(uuid,integer) FROM PUBLIC, anonymous, authenticated;

GRANT EXECUTE ON FUNCTION public.create_pilot_program(uuid,uuid,text,integer,date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_property_to_pilot(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_my_property_pilot(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_pilot_installation_status(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pilot_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.capture_pilot_system_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_pilot_manual_observation(uuid,text,numeric,text,integer,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pilot_programs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pilot_readiness(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pilot_properties(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_pilot_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pilot_manual_observations(uuid,integer) TO authenticated;

COMMENT ON TABLE public.pilot_system_snapshots IS 'System-derived pilot metrics only. Values come from current device state and the preceding 24h of security events; they are not promises of service or crime prevention.';
COMMENT ON TABLE public.pilot_manual_observations IS 'Explicitly manual pilot observations. source_kind is constrained to manual so manually entered values cannot masquerade as system-derived metrics.';
COMMENT ON FUNCTION public.get_pilot_readiness(uuid) IS 'Aggregated pilot readiness. Does not expose private camera streams/recordings and does not imply human monitoring, public dispatch or prevention of crime.';

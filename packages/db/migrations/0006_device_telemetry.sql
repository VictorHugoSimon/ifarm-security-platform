ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS expected_heartbeat_seconds integer NOT NULL DEFAULT 300;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS offline_after_seconds integer NOT NULL DEFAULT 900;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS last_status_changed_at timestamptz;
ALTER TABLE public.devices ADD CONSTRAINT devices_expected_heartbeat_range CHECK (expected_heartbeat_seconds BETWEEN 30 AND 86400);
ALTER TABLE public.devices ADD CONSTRAINT devices_offline_after_valid CHECK (offline_after_seconds >= expected_heartbeat_seconds AND offline_after_seconds <= 604800);

CREATE TABLE public.device_ingest_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(device_id,key_hash)
);
CREATE UNIQUE INDEX idx_device_ingest_keys_active_hash ON public.device_ingest_keys(key_hash) WHERE status='active';
ALTER TABLE public.device_ingest_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.device_ingest_keys FROM authenticated, anonymous;

CREATE TABLE public.device_telemetry (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  event_id text,
  status device_status NOT NULL,
  source_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  battery_pct numeric(5,2),
  signal_rssi integer,
  connection_type text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (battery_pct IS NULL OR (battery_pct >= 0 AND battery_pct <= 100)),
  CHECK (signal_rssi IS NULL OR (signal_rssi BETWEEN -200 AND 0))
);
CREATE UNIQUE INDEX idx_device_telemetry_event ON public.device_telemetry(device_id,event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_device_telemetry_device_time ON public.device_telemetry(device_id,received_at DESC);
CREATE INDEX idx_device_telemetry_org_time ON public.device_telemetry(organization_id,received_at DESC);
ALTER TABLE public.device_telemetry ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_telemetry_read_visible ON public.device_telemetry FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.devices d WHERE d.id=device_telemetry.device_id));
GRANT SELECT ON TABLE public.device_telemetry TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.device_telemetry FROM authenticated, anonymous;

CREATE OR REPLACE FUNCTION public.app_can_manage_device(p_device_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,auth,pg_temp AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.devices d
     WHERE d.id=p_device_id
       AND (
         public.app_is_platform_admin()
         OR (d.community_shared AND d.neighborhood_id IS NOT NULL AND public.app_can_manage_neighborhood(d.neighborhood_id))
         OR ((NOT d.community_shared) AND d.property_id IS NOT NULL AND public.app_can_manage_property(d.property_id))
       )
  );
$$;
GRANT EXECUTE ON FUNCTION public.app_can_manage_device(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_device_ingest_key(p_device_id uuid, p_key_hash text, p_label text DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,auth,pg_temp AS $$
DECLARE v_org uuid; v_id uuid; v_active_count integer;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_key_hash'; END IF;
  SELECT organization_id INTO v_org FROM public.devices WHERE id=p_device_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'device_not_found'; END IF;
  IF NOT public.app_can_manage_device(p_device_id) THEN RAISE EXCEPTION 'device_management_required'; END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN RAISE EXCEPTION 'invalid_expiration'; END IF;
  SELECT count(*) INTO v_active_count FROM public.device_ingest_keys WHERE device_id=p_device_id AND status='active' AND (expires_at IS NULL OR expires_at > now());
  IF v_active_count >= 5 THEN RAISE EXCEPTION 'active_key_limit_reached'; END IF;
  INSERT INTO public.device_ingest_keys(organization_id,device_id,key_hash,label,expires_at)
  VALUES(v_org,p_device_id,lower(p_key_hash),nullif(trim(p_label),''),p_expires_at) RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(v_org,public.app_current_user_id(),'device.ingest_key.created','device',p_device_id::text,jsonb_build_object('key_id',v_id,'label',p_label,'expires_at',p_expires_at));
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.register_device_ingest_key(uuid,text,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_device_ingest_keys(p_device_id uuid)
RETURNS TABLE(id uuid,label text,status text,expires_at timestamptz,last_used_at timestamptz,created_at timestamptz,revoked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,auth,pg_temp AS $$
BEGIN
  IF NOT public.app_can_manage_device(p_device_id) THEN RAISE EXCEPTION 'device_management_required'; END IF;
  RETURN QUERY SELECT k.id,k.label,k.status,k.expires_at,k.last_used_at,k.created_at,k.revoked_at FROM public.device_ingest_keys k WHERE k.device_id=p_device_id ORDER BY k.created_at DESC;
END $$;
GRANT EXECUTE ON FUNCTION public.list_device_ingest_keys(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_device_ingest_key(p_key_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,auth,pg_temp AS $$
DECLARE v_device uuid; v_org uuid;
BEGIN
  SELECT device_id,organization_id INTO v_device,v_org FROM public.device_ingest_keys WHERE id=p_key_id;
  IF v_device IS NULL THEN RAISE EXCEPTION 'key_not_found'; END IF;
  IF NOT public.app_can_manage_device(v_device) THEN RAISE EXCEPTION 'device_management_required'; END IF;
  UPDATE public.device_ingest_keys SET status='revoked',revoked_at=now() WHERE id=p_key_id AND status='active';
  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(v_org,public.app_current_user_id(),'device.ingest_key.revoked','device',v_device::text,jsonb_build_object('key_id',p_key_id));
  RETURN p_key_id;
END $$;
GRANT EXECUTE ON FUNCTION public.revoke_device_ingest_key(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ingest_device_heartbeat(
  p_device_id uuid, p_key_hash text, p_event_id text, p_status device_status,
  p_source_at timestamptz DEFAULT NULL, p_battery_pct numeric DEFAULT NULL,
  p_signal_rssi integer DEFAULT NULL, p_connection_type text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(accepted boolean,current_status device_status,received_at timestamptz,transition text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_key uuid; v_org uuid; v_old_status device_status; v_neighborhood uuid; v_property uuid;
  v_device_type device_type; v_received timestamptz:=now(); v_existing_status device_status;
  v_existing_received timestamptz; v_transition text:='heartbeat'; v_severity alert_severity;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_device_key'; END IF;
  IF p_event_id IS NOT NULL AND (length(p_event_id)=0 OR length(p_event_id)>128) THEN RAISE EXCEPTION 'invalid_event_id'; END IF;
  IF p_source_at IS NOT NULL AND p_source_at > now() + interval '10 minutes' THEN RAISE EXCEPTION 'source_time_in_future'; END IF;
  IF p_battery_pct IS NOT NULL AND (p_battery_pct < 0 OR p_battery_pct > 100) THEN RAISE EXCEPTION 'invalid_battery'; END IF;
  IF p_signal_rssi IS NOT NULL AND (p_signal_rssi < -200 OR p_signal_rssi > 0) THEN RAISE EXCEPTION 'invalid_signal'; END IF;
  IF p_connection_type IS NOT NULL AND length(p_connection_type)>32 THEN RAISE EXCEPTION 'invalid_connection_type'; END IF;
  IF octet_length(coalesce(p_metadata,'{}'::jsonb)::text)>8192 THEN RAISE EXCEPTION 'metadata_too_large'; END IF;
  SELECT k.id,d.organization_id,d.status,d.neighborhood_id,d.property_id,d.device_type
    INTO v_key,v_org,v_old_status,v_neighborhood,v_property,v_device_type
    FROM public.device_ingest_keys k JOIN public.devices d ON d.id=k.device_id
   WHERE k.device_id=p_device_id AND k.key_hash=lower(p_key_hash) AND k.status='active' AND (k.expires_at IS NULL OR k.expires_at>v_received)
   LIMIT 1;
  IF v_key IS NULL THEN RAISE EXCEPTION 'invalid_device_key'; END IF;
  UPDATE public.device_ingest_keys SET last_used_at=v_received WHERE id=v_key;
  IF p_event_id IS NOT NULL THEN
    SELECT t.status,t.received_at INTO v_existing_status,v_existing_received FROM public.device_telemetry t WHERE t.device_id=p_device_id AND t.event_id=p_event_id LIMIT 1;
    IF FOUND THEN RETURN QUERY SELECT true,v_existing_status,v_existing_received,'duplicate'::text; RETURN; END IF;
  END IF;
  INSERT INTO public.device_telemetry(organization_id,device_id,event_id,status,source_at,received_at,battery_pct,signal_rssi,connection_type,metadata)
  VALUES(v_org,p_device_id,p_event_id,p_status,p_source_at,v_received,p_battery_pct,p_signal_rssi,nullif(trim(p_connection_type),''),coalesce(p_metadata,'{}'::jsonb));
  IF v_old_status IS DISTINCT FROM p_status THEN
    IF v_old_status='offline' AND p_status='online' THEN v_transition:='restored';
    ELSIF p_status='offline' THEN v_transition:='offline';
    ELSIF p_status='degraded' THEN v_transition:='degraded'; ELSE v_transition:='status_changed'; END IF;
    v_severity:=CASE WHEN p_status='offline' AND v_device_type IN ('gateway','nvr') THEN 'high'::alert_severity WHEN p_status IN ('offline','degraded') THEN 'attention'::alert_severity ELSE 'informational'::alert_severity END;
    INSERT INTO public.security_events(organization_id,neighborhood_id,property_id,device_id,event_type,severity,human_validation_status,occurred_at,metadata)
    VALUES(v_org,v_neighborhood,v_property,p_device_id,CASE WHEN v_transition='restored' THEN 'device.restored' WHEN v_transition='offline' THEN 'device.offline' WHEN v_transition='degraded' THEN 'device.degraded' ELSE 'device.status_changed' END,v_severity,'not_required',coalesce(p_source_at,v_received),jsonb_build_object('old_status',v_old_status,'new_status',p_status,'source','heartbeat'));
  END IF;
  UPDATE public.devices SET status=p_status,last_seen_at=v_received,last_status_changed_at=CASE WHEN v_old_status IS DISTINCT FROM p_status THEN v_received ELSE last_status_changed_at END WHERE id=p_device_id;
  RETURN QUERY SELECT true,p_status,v_received,v_transition;
END $$;
REVOKE EXECUTE ON FUNCTION public.ingest_device_heartbeat(uuid,text,text,device_status,timestamptz,numeric,integer,text,jsonb) FROM public,authenticated,anonymous;

CREATE OR REPLACE FUNCTION public.get_device_health()
RETURNS TABLE(device_id uuid,name text,device_type text,scope text,status text,last_seen_at timestamptz,seconds_since_last_seen bigint,expected_heartbeat_seconds integer,offline_after_seconds integer,battery_pct numeric,signal_rssi integer,connection_type text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,auth,pg_temp AS $$
  SELECT d.id,d.name,d.device_type::text,CASE WHEN d.community_shared THEN 'community' ELSE 'private' END,d.status::text,d.last_seen_at,
         CASE WHEN d.last_seen_at IS NULL THEN NULL ELSE extract(epoch FROM (now()-d.last_seen_at))::bigint END,
         d.expected_heartbeat_seconds,d.offline_after_seconds,t.battery_pct,t.signal_rssi,t.connection_type
    FROM public.devices d
    LEFT JOIN LATERAL (
      SELECT dt.battery_pct,dt.signal_rssi,dt.connection_type FROM public.device_telemetry dt WHERE dt.device_id=d.id ORDER BY dt.received_at DESC LIMIT 1
    ) t ON true
   ORDER BY d.name;
$$;
GRANT EXECUTE ON FUNCTION public.get_device_health() TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_stale_devices() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record; v_count integer:=0; v_now timestamptz:=now();
BEGIN
  FOR r IN
    SELECT d.id,d.organization_id,d.neighborhood_id,d.property_id,d.device_type,d.status,d.last_seen_at
      FROM public.devices d
     WHERE d.status NOT IN ('offline','maintenance') AND d.last_seen_at IS NOT NULL
       AND d.last_seen_at < v_now - make_interval(secs=>d.offline_after_seconds)
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.devices SET status='offline',last_status_changed_at=v_now WHERE id=r.id;
    INSERT INTO public.device_telemetry(organization_id,device_id,status,received_at,metadata)
    VALUES(r.organization_id,r.id,'offline',v_now,jsonb_build_object('inferred',true,'reason','heartbeat_timeout'));
    INSERT INTO public.security_events(organization_id,neighborhood_id,property_id,device_id,event_type,severity,human_validation_status,occurred_at,metadata)
    VALUES(r.organization_id,r.neighborhood_id,r.property_id,r.id,'device.offline',CASE WHEN r.device_type IN ('gateway','nvr') THEN 'high'::alert_severity ELSE 'attention'::alert_severity END,'not_required',v_now,jsonb_build_object('old_status',r.status,'new_status','offline','source','reconciler','last_seen_at',r.last_seen_at));
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE EXECUTE ON FUNCTION public.reconcile_stale_devices() FROM public,authenticated,anonymous;

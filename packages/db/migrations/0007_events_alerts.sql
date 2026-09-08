ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES public.app_users(id);
ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS validated_by uuid REFERENCES public.app_users(id);
ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS validated_at timestamptz;
ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS validation_note text;
ALTER TABLE public.security_events ADD CONSTRAINT security_events_validation_status_check CHECK (human_validation_status IN ('pending','confirmed','rejected','not_required'));
ALTER TABLE public.security_events ADD CONSTRAINT security_events_validation_note_length CHECK (validation_note IS NULL OR length(validation_note)<=1000);

CREATE TABLE public.event_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  event_id uuid NOT NULL REFERENCES public.security_events(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES public.app_users(id),
  action text NOT NULL CHECK (action IN ('acknowledged','validated_confirmed','validated_rejected')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (note IS NULL OR length(note)<=1000)
);
CREATE INDEX idx_event_actions_event_time ON public.event_actions(event_id,created_at DESC);
ALTER TABLE public.event_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_actions_scope_read ON public.event_actions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.security_events e WHERE e.id=event_actions.event_id AND public.app_has_scope_access(e.organization_id,e.neighborhood_id,e.property_id)));
GRANT SELECT ON TABLE public.event_actions TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.event_actions FROM authenticated,anonymous;

CREATE TABLE public.alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  neighborhood_id uuid REFERENCES public.neighborhoods(id),
  property_id uuid REFERENCES public.properties(id),
  recipient_user_id uuid NOT NULL REFERENCES public.app_users(id),
  name text NOT NULL,
  event_type text,
  min_severity alert_severity NOT NULL DEFAULT 'attention',
  channel text NOT NULL CHECK (channel IN ('app','push','email','sms','whatsapp')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(name) BETWEEN 1 AND 120),
  CHECK (event_type IS NULL OR length(event_type) BETWEEN 1 AND 120),
  CHECK (NOT (property_id IS NOT NULL AND neighborhood_id IS NOT NULL))
);
CREATE INDEX idx_alert_rules_recipient ON public.alert_rules(recipient_user_id,enabled);
CREATE INDEX idx_alert_rules_scope ON public.alert_rules(organization_id,neighborhood_id,property_id);
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY alert_rules_self_read ON public.alert_rules FOR SELECT TO authenticated USING (recipient_user_id=public.app_current_user_id());
GRANT SELECT ON TABLE public.alert_rules TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.alert_rules FROM authenticated,anonymous;

ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_status_check CHECK (status IN ('queued','blocked_external','sent','failed','cancelled'));
ALTER TABLE public.alerts ADD CONSTRAINT alerts_channel_check CHECK (channel IN ('app','push','email','sms','whatsapp'));
CREATE UNIQUE INDEX idx_alerts_dedupe ON public.alerts(dedupe_key) WHERE dedupe_key IS NOT NULL;
ALTER POLICY alerts_scope_read ON public.alerts USING (
  public.app_has_org_membership(organization_id)
  AND (recipient_user_id IS NULL OR recipient_user_id=public.app_current_user_id())
  AND (event_id IS NULL OR EXISTS (SELECT 1 FROM public.security_events e WHERE e.id=alerts.event_id AND public.app_has_scope_access(e.organization_id,e.neighborhood_id,e.property_id)))
  AND (incident_id IS NULL OR EXISTS (SELECT 1 FROM public.incidents i WHERE i.id=alerts.incident_id AND public.app_has_scope_access(i.organization_id,i.neighborhood_id,i.property_id)))
);

CREATE OR REPLACE FUNCTION public.get_event_feed(p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid,event_type text,severity text,confidence numeric,human_validation_status text,acknowledged_at timestamptz,occurred_at timestamptz,received_at timestamptz,device_id uuid,device_name text,scope text,organization_id uuid,neighborhood_id uuid,property_id uuid,metadata jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,auth,pg_temp AS $$
  SELECT e.id,e.event_type,e.severity::text,e.confidence,e.human_validation_status,e.acknowledged_at,e.occurred_at,e.received_at,e.device_id,d.name,
         CASE WHEN e.property_id IS NOT NULL THEN 'private' ELSE 'community' END,e.organization_id,e.neighborhood_id,e.property_id,e.metadata
    FROM public.security_events e LEFT JOIN public.devices d ON d.id=e.device_id
   ORDER BY e.occurred_at DESC LIMIT least(greatest(coalesce(p_limit,100),1),500);
$$;
GRANT EXECUTE ON FUNCTION public.get_event_feed(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.ack_security_event(p_event_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE v_org uuid; v_neighborhood uuid; v_property uuid; v_user uuid;
BEGIN
  SELECT organization_id,neighborhood_id,property_id INTO v_org,v_neighborhood,v_property FROM public.security_events WHERE id=p_event_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT public.app_has_scope_access(v_org,v_neighborhood,v_property) THEN RAISE EXCEPTION 'event_access_required'; END IF;
  v_user:=public.app_current_user_id(); IF v_user IS NULL THEN RAISE EXCEPTION 'active_user_required'; END IF;
  UPDATE public.security_events SET acknowledged_by=coalesce(acknowledged_by,v_user),acknowledged_at=coalesce(acknowledged_at,now()) WHERE id=p_event_id;
  IF NOT EXISTS(SELECT 1 FROM public.event_actions WHERE event_id=p_event_id AND actor_user_id=v_user AND action='acknowledged') THEN
    INSERT INTO public.event_actions(organization_id,event_id,actor_user_id,action) VALUES(v_org,p_event_id,v_user,'acknowledged');
  END IF;
  RETURN p_event_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.ack_security_event(uuid) FROM public,anonymous;
GRANT EXECUTE ON FUNCTION public.ack_security_event(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_security_event(p_event_id uuid,p_decision text,p_note text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE v_org uuid; v_neighborhood uuid; v_property uuid; v_user uuid; v_current text; v_action text;
BEGIN
  IF p_decision NOT IN ('confirmed','rejected') THEN RAISE EXCEPTION 'invalid_validation_decision'; END IF;
  IF p_note IS NOT NULL AND length(p_note)>1000 THEN RAISE EXCEPTION 'validation_note_too_long'; END IF;
  SELECT organization_id,neighborhood_id,property_id,human_validation_status INTO v_org,v_neighborhood,v_property,v_current FROM public.security_events WHERE id=p_event_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT public.app_has_scope_access(v_org,v_neighborhood,v_property) THEN RAISE EXCEPTION 'event_access_required'; END IF;
  IF v_current<>'pending' THEN RAISE EXCEPTION 'event_not_pending_validation'; END IF;
  v_user:=public.app_current_user_id(); IF v_user IS NULL THEN RAISE EXCEPTION 'active_user_required'; END IF;
  UPDATE public.security_events SET human_validation_status=p_decision,validated_by=v_user,validated_at=now(),validation_note=nullif(trim(p_note),'') WHERE id=p_event_id;
  v_action:=CASE WHEN p_decision='confirmed' THEN 'validated_confirmed' ELSE 'validated_rejected' END;
  INSERT INTO public.event_actions(organization_id,event_id,actor_user_id,action,note) VALUES(v_org,p_event_id,v_user,v_action,nullif(trim(p_note),''));
  RETURN p_event_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.validate_security_event(uuid,text,text) FROM public,anonymous;
GRANT EXECUTE ON FUNCTION public.validate_security_event(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_my_alert_rule(p_organization_id uuid,p_name text,p_event_type text DEFAULT NULL,p_min_severity alert_severity DEFAULT 'attention',p_channel text DEFAULT 'app',p_neighborhood_id uuid DEFAULT NULL,p_property_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE v_user uuid; v_id uuid; v_scope_ok boolean:=false;
BEGIN
  v_user:=public.app_current_user_id(); IF v_user IS NULL THEN RAISE EXCEPTION 'active_user_required'; END IF;
  IF p_channel NOT IN ('app','push','email','sms','whatsapp') THEN RAISE EXCEPTION 'invalid_channel'; END IF;
  IF p_name IS NULL OR length(trim(p_name))<1 OR length(trim(p_name))>120 THEN RAISE EXCEPTION 'invalid_rule_name'; END IF;
  IF p_event_type IS NOT NULL AND (length(trim(p_event_type))<1 OR length(trim(p_event_type))>120) THEN RAISE EXCEPTION 'invalid_event_type'; END IF;
  IF p_property_id IS NOT NULL AND p_neighborhood_id IS NOT NULL THEN RAISE EXCEPTION 'single_scope_required'; END IF;
  IF p_property_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=p_property_id AND p.organization_id=p_organization_id) THEN RAISE EXCEPTION 'property_scope_mismatch'; END IF;
    v_scope_ok:=public.app_has_scope_access(p_organization_id,NULL,p_property_id);
  ELSIF p_neighborhood_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.neighborhoods n WHERE n.id=p_neighborhood_id AND n.organization_id=p_organization_id) THEN RAISE EXCEPTION 'neighborhood_scope_mismatch'; END IF;
    v_scope_ok:=public.app_has_scope_access(p_organization_id,p_neighborhood_id,NULL);
  ELSE
    v_scope_ok:=public.app_is_platform_admin() OR public.app_has_org_role(p_organization_id,ARRAY['admin_organization']);
  END IF;
  IF NOT v_scope_ok THEN RAISE EXCEPTION 'alert_rule_scope_required'; END IF;
  INSERT INTO public.alert_rules(organization_id,neighborhood_id,property_id,recipient_user_id,name,event_type,min_severity,channel)
  VALUES(p_organization_id,p_neighborhood_id,p_property_id,v_user,trim(p_name),nullif(trim(p_event_type),''),p_min_severity,p_channel) RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES(p_organization_id,v_user,'alert_rule.created','alert_rule',v_id::text,jsonb_build_object('channel',p_channel,'event_type',p_event_type,'min_severity',p_min_severity::text,'neighborhood_id',p_neighborhood_id,'property_id',p_property_id));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_my_alert_rule(uuid,text,text,alert_severity,text,uuid,uuid) FROM public,anonymous;
GRANT EXECUTE ON FUNCTION public.create_my_alert_rule(uuid,text,text,alert_severity,text,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_my_alert_rule(p_rule_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE v_user uuid; v_org uuid;
BEGIN
  v_user:=public.app_current_user_id(); IF v_user IS NULL THEN RAISE EXCEPTION 'active_user_required'; END IF;
  SELECT organization_id INTO v_org FROM public.alert_rules WHERE id=p_rule_id AND recipient_user_id=v_user;
  IF v_org IS NULL THEN RAISE EXCEPTION 'alert_rule_not_found'; END IF;
  DELETE FROM public.alert_rules WHERE id=p_rule_id AND recipient_user_id=v_user;
  INSERT INTO public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) VALUES(v_org,v_user,'alert_rule.deleted','alert_rule',p_rule_id::text);
  RETURN p_rule_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.delete_my_alert_rule(uuid) FROM public,anonymous;
GRANT EXECUTE ON FUNCTION public.delete_my_alert_rule(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.queue_alerts_for_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record; v_status text;
BEGIN
  FOR r IN
    SELECT ar.id,ar.recipient_user_id,ar.channel FROM public.alert_rules ar
    JOIN public.app_users u ON u.id=ar.recipient_user_id AND u.status='active'
    WHERE ar.enabled=true AND ar.organization_id=NEW.organization_id
      AND (ar.event_type IS NULL OR ar.event_type=NEW.event_type)
      AND NEW.severity>=ar.min_severity
      AND ((ar.property_id IS NOT NULL AND NEW.property_id=ar.property_id)
        OR (ar.neighborhood_id IS NOT NULL AND NEW.property_id IS NULL AND NEW.neighborhood_id=ar.neighborhood_id)
        OR (ar.property_id IS NULL AND ar.neighborhood_id IS NULL))
  LOOP
    v_status:=CASE WHEN r.channel='app' THEN 'queued' ELSE 'blocked_external' END;
    INSERT INTO public.alerts(organization_id,event_id,severity,channel,recipient_user_id,status,dedupe_key)
    VALUES(NEW.organization_id,NEW.id,NEW.severity,r.channel,r.recipient_user_id,v_status,'event:'||NEW.id::text||':rule:'||r.id::text)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.queue_alerts_for_event() FROM public,authenticated,anonymous;
CREATE TRIGGER trg_security_event_alerts AFTER INSERT ON public.security_events FOR EACH ROW EXECUTE FUNCTION public.queue_alerts_for_event();

CREATE OR REPLACE FUNCTION public.get_alert_feed(p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid,event_id uuid,severity text,channel text,status text,created_at timestamptz,event_type text,occurred_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,auth,pg_temp AS $$
  SELECT a.id,a.event_id,a.severity::text,a.channel,a.status,a.created_at,e.event_type,e.occurred_at
    FROM public.alerts a LEFT JOIN public.security_events e ON e.id=a.event_id
   ORDER BY a.created_at DESC LIMIT least(greatest(coalesce(p_limit,100),1),500);
$$;
GRANT EXECUTE ON FUNCTION public.get_alert_feed(integer) TO authenticated;

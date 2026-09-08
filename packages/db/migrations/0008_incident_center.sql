ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES public.app_users(id);
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.incidents ADD CONSTRAINT incidents_status_check CHECK (status IN ('open','investigating','monitoring','resolved','closed'));
ALTER TABLE public.incidents ADD CONSTRAINT incidents_title_length CHECK (length(title) BETWEEN 3 AND 160);
ALTER TABLE public.incidents ADD CONSTRAINT incidents_summary_length CHECK (summary IS NULL OR length(summary)<=4000);

CREATE TABLE public.incident_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES public.app_users(id),
  action text NOT NULL CHECK (action IN ('created','event_added','status_changed','claimed','note_added')),
  note text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (note IS NULL OR length(note)<=2000)
);
CREATE INDEX idx_incident_actions_incident_time ON public.incident_actions(incident_id,created_at DESC);
ALTER TABLE public.incident_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY incident_actions_scope_read ON public.incident_actions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.incidents i WHERE i.id=incident_actions.incident_id AND public.app_has_scope_access(i.organization_id,i.neighborhood_id,i.property_id)));
GRANT SELECT ON TABLE public.incident_actions TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.incident_actions FROM authenticated,anonymous;

CREATE OR REPLACE FUNCTION public.create_incident_from_event(p_event_id uuid,p_title text DEFAULT NULL,p_summary text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE v_org uuid; v_neighborhood uuid; v_property uuid; v_severity alert_severity; v_type text; v_validation text; v_user uuid; v_incident uuid; v_title text;
BEGIN
  SELECT organization_id,neighborhood_id,property_id,severity,event_type,human_validation_status INTO v_org,v_neighborhood,v_property,v_severity,v_type,v_validation FROM public.security_events WHERE id=p_event_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT public.app_has_scope_access(v_org,v_neighborhood,v_property) THEN RAISE EXCEPTION 'event_access_required'; END IF;
  IF v_validation='pending' THEN RAISE EXCEPTION 'event_validation_required'; END IF;
  IF v_validation='rejected' THEN RAISE EXCEPTION 'event_rejected'; END IF;
  v_user:=public.app_current_user_id(); IF v_user IS NULL THEN RAISE EXCEPTION 'active_user_required'; END IF;
  v_title:=coalesce(nullif(trim(p_title),''),'Incidente - '||v_type);
  IF length(v_title)<3 OR length(v_title)>160 THEN RAISE EXCEPTION 'invalid_incident_title'; END IF;
  IF p_summary IS NOT NULL AND length(p_summary)>4000 THEN RAISE EXCEPTION 'incident_summary_too_long'; END IF;
  INSERT INTO public.incidents(organization_id,neighborhood_id,property_id,title,severity,status,responsible_user_id,created_by_user_id,summary,updated_at)
  VALUES(v_org,v_neighborhood,v_property,v_title,v_severity,'open',v_user,v_user,nullif(trim(p_summary),''),now()) RETURNING id INTO v_incident;
  INSERT INTO public.incident_events(incident_id,event_id) VALUES(v_incident,p_event_id) ON CONFLICT DO NOTHING;
  INSERT INTO public.incident_actions(organization_id,incident_id,actor_user_id,action,details)
  VALUES(v_org,v_incident,v_user,'created',jsonb_build_object('source_event_id',p_event_id,'event_type',v_type));
  UPDATE public.security_events SET acknowledged_by=coalesce(acknowledged_by,v_user),acknowledged_at=coalesce(acknowledged_at,now()) WHERE id=p_event_id;
  IF NOT EXISTS(SELECT 1 FROM public.event_actions WHERE event_id=p_event_id AND actor_user_id=v_user AND action='acknowledged') THEN
    INSERT INTO public.event_actions(organization_id,event_id,actor_user_id,action) VALUES(v_org,p_event_id,v_user,'acknowledged');
  END IF;
  RETURN v_incident;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_incident_from_event(uuid,text,text) FROM public,anonymous;
GRANT EXECUTE ON FUNCTION public.create_incident_from_event(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_event_to_incident(p_incident_id uuid,p_event_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE v_org uuid; v_neighborhood uuid; v_property uuid; v_status text; e_org uuid; e_neighborhood uuid; e_property uuid; e_validation text; v_user uuid; v_added uuid;
BEGIN
  SELECT organization_id,neighborhood_id,property_id,status INTO v_org,v_neighborhood,v_property,v_status FROM public.incidents WHERE id=p_incident_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'incident_not_found'; END IF;
  IF v_status='closed' THEN RAISE EXCEPTION 'incident_closed'; END IF;
  IF NOT public.app_has_scope_access(v_org,v_neighborhood,v_property) THEN RAISE EXCEPTION 'incident_access_required'; END IF;
  SELECT organization_id,neighborhood_id,property_id,human_validation_status INTO e_org,e_neighborhood,e_property,e_validation FROM public.security_events WHERE id=p_event_id;
  IF e_org IS NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF e_validation='pending' THEN RAISE EXCEPTION 'event_validation_required'; END IF;
  IF e_validation='rejected' THEN RAISE EXCEPTION 'event_rejected'; END IF;
  IF e_org<>v_org OR e_property IS DISTINCT FROM v_property OR (v_property IS NULL AND e_neighborhood IS DISTINCT FROM v_neighborhood) THEN RAISE EXCEPTION 'incident_event_scope_mismatch'; END IF;
  v_user:=public.app_current_user_id(); IF v_user IS NULL THEN RAISE EXCEPTION 'active_user_required'; END IF;
  INSERT INTO public.incident_events(incident_id,event_id) VALUES(p_incident_id,p_event_id) ON CONFLICT DO NOTHING RETURNING event_id INTO v_added;
  IF v_added IS NOT NULL THEN
    INSERT INTO public.incident_actions(organization_id,incident_id,actor_user_id,action,details) VALUES(v_org,p_incident_id,v_user,'event_added',jsonb_build_object('event_id',p_event_id));
    UPDATE public.incidents SET updated_at=now() WHERE id=p_incident_id;
  END IF;
  RETURN p_incident_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.add_event_to_incident(uuid,uuid) FROM public,anonymous;
GRANT EXECUTE ON FUNCTION public.add_event_to_incident(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_incident_status(p_incident_id uuid,p_status text,p_note text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE v_org uuid; v_neighborhood uuid; v_property uuid; v_old_status text; v_user uuid;
BEGIN
  IF p_status NOT IN ('open','investigating','monitoring','resolved','closed') THEN RAISE EXCEPTION 'invalid_incident_status'; END IF;
  IF p_note IS NOT NULL AND length(p_note)>2000 THEN RAISE EXCEPTION 'incident_note_too_long'; END IF;
  SELECT organization_id,neighborhood_id,property_id,status INTO v_org,v_neighborhood,v_property,v_old_status FROM public.incidents WHERE id=p_incident_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'incident_not_found'; END IF;
  IF NOT public.app_has_scope_access(v_org,v_neighborhood,v_property) THEN RAISE EXCEPTION 'incident_access_required'; END IF;
  IF v_old_status='closed' AND p_status<>'closed' THEN RAISE EXCEPTION 'closed_incident_immutable'; END IF;
  v_user:=public.app_current_user_id(); IF v_user IS NULL THEN RAISE EXCEPTION 'active_user_required'; END IF;
  UPDATE public.incidents SET status=p_status,closed_at=CASE WHEN p_status='closed' THEN coalesce(closed_at,now()) ELSE NULL END,updated_at=now() WHERE id=p_incident_id;
  IF v_old_status IS DISTINCT FROM p_status THEN
    INSERT INTO public.incident_actions(organization_id,incident_id,actor_user_id,action,note,details)
    VALUES(v_org,p_incident_id,v_user,'status_changed',nullif(trim(p_note),''),jsonb_build_object('old_status',v_old_status,'new_status',p_status));
  END IF;
  RETURN p_incident_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.update_incident_status(uuid,text,text) FROM public,anonymous;
GRANT EXECUTE ON FUNCTION public.update_incident_status(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_incident(p_incident_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE v_org uuid; v_neighborhood uuid; v_property uuid; v_status text; v_user uuid;
BEGIN
  SELECT organization_id,neighborhood_id,property_id,status INTO v_org,v_neighborhood,v_property,v_status FROM public.incidents WHERE id=p_incident_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'incident_not_found'; END IF;
  IF v_status='closed' THEN RAISE EXCEPTION 'incident_closed'; END IF;
  IF NOT public.app_has_scope_access(v_org,v_neighborhood,v_property) THEN RAISE EXCEPTION 'incident_access_required'; END IF;
  v_user:=public.app_current_user_id(); IF v_user IS NULL THEN RAISE EXCEPTION 'active_user_required'; END IF;
  UPDATE public.incidents SET responsible_user_id=v_user,updated_at=now() WHERE id=p_incident_id;
  INSERT INTO public.incident_actions(organization_id,incident_id,actor_user_id,action,details) VALUES(v_org,p_incident_id,v_user,'claimed',jsonb_build_object('responsible_user_id',v_user));
  RETURN p_incident_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.claim_incident(uuid) FROM public,anonymous;
GRANT EXECUTE ON FUNCTION public.claim_incident(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_incident_note(p_incident_id uuid,p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE v_org uuid; v_neighborhood uuid; v_property uuid; v_status text; v_user uuid;
BEGIN
  IF p_note IS NULL OR length(trim(p_note))<1 OR length(trim(p_note))>2000 THEN RAISE EXCEPTION 'invalid_incident_note'; END IF;
  SELECT organization_id,neighborhood_id,property_id,status INTO v_org,v_neighborhood,v_property,v_status FROM public.incidents WHERE id=p_incident_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'incident_not_found'; END IF;
  IF v_status='closed' THEN RAISE EXCEPTION 'incident_closed'; END IF;
  IF NOT public.app_has_scope_access(v_org,v_neighborhood,v_property) THEN RAISE EXCEPTION 'incident_access_required'; END IF;
  v_user:=public.app_current_user_id(); IF v_user IS NULL THEN RAISE EXCEPTION 'active_user_required'; END IF;
  INSERT INTO public.incident_actions(organization_id,incident_id,actor_user_id,action,note) VALUES(v_org,p_incident_id,v_user,'note_added',trim(p_note));
  UPDATE public.incidents SET updated_at=now() WHERE id=p_incident_id;
  RETURN p_incident_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.add_incident_note(uuid,text) FROM public,anonymous;
GRANT EXECUTE ON FUNCTION public.add_incident_note(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_incident_feed(p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid,title text,severity text,status text,opened_at timestamptz,updated_at timestamptz,closed_at timestamptz,responsible_user_id uuid,responsible_name text,scope text,organization_id uuid,neighborhood_id uuid,property_id uuid,event_count bigint,summary text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,auth,pg_temp AS $$
  SELECT i.id,i.title,i.severity::text,i.status,i.opened_at,i.updated_at,i.closed_at,i.responsible_user_id,u.full_name,
         CASE WHEN i.property_id IS NOT NULL THEN 'private' ELSE 'community' END,i.organization_id,i.neighborhood_id,i.property_id,count(ie.event_id),i.summary
    FROM public.incidents i LEFT JOIN public.app_users u ON u.id=i.responsible_user_id LEFT JOIN public.incident_events ie ON ie.incident_id=i.id
   GROUP BY i.id,u.full_name ORDER BY i.opened_at DESC LIMIT least(greatest(coalesce(p_limit,100),1),500);
$$;
GRANT EXECUTE ON FUNCTION public.get_incident_feed(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_incident_timeline(p_incident_id uuid)
RETURNS TABLE(id bigint,action text,note text,details jsonb,actor_user_id uuid,actor_name text,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,auth,pg_temp AS $$
DECLARE v_org uuid; v_neighborhood uuid; v_property uuid;
BEGIN
  SELECT organization_id,neighborhood_id,property_id INTO v_org,v_neighborhood,v_property FROM public.incidents WHERE incidents.id=p_incident_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'incident_not_found'; END IF;
  IF NOT public.app_has_scope_access(v_org,v_neighborhood,v_property) THEN RAISE EXCEPTION 'incident_access_required'; END IF;
  RETURN QUERY SELECT a.id,a.action,a.note,a.details,a.actor_user_id,u.full_name,a.created_at FROM public.incident_actions a JOIN public.app_users u ON u.id=a.actor_user_id WHERE a.incident_id=p_incident_id ORDER BY a.created_at DESC;
END $$;
GRANT EXECUTE ON FUNCTION public.get_incident_timeline(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_incident_events(p_incident_id uuid)
RETURNS TABLE(event_id uuid,event_type text,severity text,human_validation_status text,occurred_at timestamptz,device_name text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,auth,pg_temp AS $$
DECLARE v_org uuid; v_neighborhood uuid; v_property uuid;
BEGIN
  SELECT organization_id,neighborhood_id,property_id INTO v_org,v_neighborhood,v_property FROM public.incidents WHERE incidents.id=p_incident_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'incident_not_found'; END IF;
  IF NOT public.app_has_scope_access(v_org,v_neighborhood,v_property) THEN RAISE EXCEPTION 'incident_access_required'; END IF;
  RETURN QUERY SELECT e.id,e.event_type,e.severity::text,e.human_validation_status,e.occurred_at,d.name FROM public.incident_events ie JOIN public.security_events e ON e.id=ie.event_id LEFT JOIN public.devices d ON d.id=e.device_id WHERE ie.incident_id=p_incident_id ORDER BY e.occurred_at DESC;
END $$;
GRANT EXECUTE ON FUNCTION public.get_incident_events(uuid) TO authenticated;

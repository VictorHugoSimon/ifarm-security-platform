-- SEC-002/003/004 — identidade, convite, RBAC e RLS.
-- Aplicado primeiro em DEV. Não promover automaticamente para STAGE/PROD.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES neon_auth."user"(id);

CREATE TABLE IF NOT EXISTS access_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  property_id uuid REFERENCES properties(id),
  email text NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_by_user_id uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role IN ('admin_ifarm','admin_organization','admin_neighborhood','owner','family','employee','technician','monitoring','authorized_authority','insurance_partner')),
  CHECK (status IN ('pending','accepted','expired','revoked'))
);

CREATE INDEX IF NOT EXISTS idx_access_invitations_email_status
  ON access_invitations(lower(email), status, expires_at);

DO $$ BEGIN
  ALTER TABLE memberships ADD CONSTRAINT memberships_role_allowed CHECK (
    role IN ('admin_ifarm','admin_organization','admin_neighborhood','owner','family','employee','technician','monitoring','authorized_authority','insurance_partner')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT u.id FROM app_users u
  WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid AND u.status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app_has_org_membership(p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m JOIN app_users u ON u.id = m.user_id
    WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
      AND u.status = 'active' AND m.status = 'active'
      AND m.organization_id = p_organization_id
  )
$$;

CREATE OR REPLACE FUNCTION app_has_scope_access(p_organization_id uuid, p_neighborhood_id uuid, p_property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m JOIN app_users u ON u.id = m.user_id
    WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
      AND u.status = 'active' AND m.status = 'active'
      AND m.organization_id = p_organization_id
      AND (
        m.role IN ('admin_ifarm','admin_organization')
        OR (p_property_id IS NOT NULL AND m.property_id = p_property_id)
        OR (p_property_id IS NULL AND p_neighborhood_id IS NOT NULL AND m.neighborhood_id = p_neighborhood_id)
      )
  )
$$;

CREATE OR REPLACE FUNCTION claim_my_invited_access()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, neon_auth AS $$
DECLARE
  v_auth_user uuid := NULLIF(auth.user_id(), '')::uuid;
  v_email text;
  v_name text;
  v_verified boolean;
  v_app_user uuid;
BEGIN
  IF v_auth_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT email, name, "emailVerified" INTO v_email, v_name, v_verified
  FROM neon_auth."user" WHERE id = v_auth_user;

  IF NOT COALESCE(v_verified, false) THEN RAISE EXCEPTION 'verified_email_required'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM access_invitations i
    WHERE lower(i.email) = lower(v_email) AND i.status = 'pending' AND i.expires_at > now()
  ) THEN RAISE EXCEPTION 'valid_invitation_required'; END IF;

  INSERT INTO app_users(auth_user_id, external_auth_id, full_name, email, status, mfa_required)
  VALUES (v_auth_user, v_auth_user::text, v_name, lower(v_email), 'active', true)
  ON CONFLICT (auth_user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, status = 'active'
  RETURNING id INTO v_app_user;

  INSERT INTO memberships(organization_id, neighborhood_id, property_id, user_id, role, status)
  SELECT i.organization_id, i.neighborhood_id, i.property_id, v_app_user, i.role, 'active'
  FROM access_invitations i
  WHERE lower(i.email) = lower(v_email) AND i.status = 'pending' AND i.expires_at > now()
  ON CONFLICT DO NOTHING;

  UPDATE access_invitations SET status = 'accepted', accepted_at = now()
  WHERE lower(email) = lower(v_email) AND status = 'pending' AND expires_at > now();

  RETURN v_app_user;
END
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE neighborhoods ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_member_read ON organizations;
CREATE POLICY org_member_read ON organizations FOR SELECT USING (app_has_org_membership(id));
DROP POLICY IF EXISTS neighborhood_scope_read ON neighborhoods;
CREATE POLICY neighborhood_scope_read ON neighborhoods FOR SELECT USING (app_has_scope_access(organization_id, id, NULL));
DROP POLICY IF EXISTS property_scope_read ON properties;
CREATE POLICY property_scope_read ON properties FOR SELECT USING (app_has_scope_access(organization_id, neighborhood_id, id));
DROP POLICY IF EXISTS area_scope_read ON areas;
CREATE POLICY area_scope_read ON areas FOR SELECT USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = areas.property_id AND app_has_scope_access(areas.organization_id, p.neighborhood_id, areas.property_id)));
DROP POLICY IF EXISTS app_user_self_read ON app_users;
CREATE POLICY app_user_self_read ON app_users FOR SELECT USING (auth_user_id = NULLIF(auth.user_id(), '')::uuid);
DROP POLICY IF EXISTS membership_self_read ON memberships;
CREATE POLICY membership_self_read ON memberships FOR SELECT USING (user_id = app_current_user_id());
DROP POLICY IF EXISTS devices_scope_read ON devices;
CREATE POLICY devices_scope_read ON devices FOR SELECT USING (app_has_scope_access(organization_id, neighborhood_id, property_id));
DROP POLICY IF EXISTS assets_scope_read ON assets;
CREATE POLICY assets_scope_read ON assets FOR SELECT USING (property_id IS NOT NULL AND EXISTS (SELECT 1 FROM properties p WHERE p.id = assets.property_id AND app_has_scope_access(assets.organization_id, p.neighborhood_id, assets.property_id)));
DROP POLICY IF EXISTS events_scope_read ON security_events;
CREATE POLICY events_scope_read ON security_events FOR SELECT USING (app_has_scope_access(organization_id, neighborhood_id, property_id));
DROP POLICY IF EXISTS incidents_scope_read ON incidents;
CREATE POLICY incidents_scope_read ON incidents FOR SELECT USING (app_has_scope_access(organization_id, neighborhood_id, property_id));
DROP POLICY IF EXISTS incident_events_scope_read ON incident_events;
CREATE POLICY incident_events_scope_read ON incident_events FOR SELECT USING (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_events.incident_id AND app_has_scope_access(i.organization_id, i.neighborhood_id, i.property_id)));
DROP POLICY IF EXISTS alerts_scope_read ON alerts;
CREATE POLICY alerts_scope_read ON alerts FOR SELECT USING (app_has_org_membership(organization_id) AND (recipient_user_id IS NULL OR recipient_user_id = app_current_user_id()));
DROP POLICY IF EXISTS evidence_scope_read ON evidence;
CREATE POLICY evidence_scope_read ON evidence FOR SELECT USING (EXISTS (SELECT 1 FROM incidents i WHERE i.id = evidence.incident_id AND app_has_scope_access(i.organization_id, i.neighborhood_id, i.property_id)));
DROP POLICY IF EXISTS recordings_scope_read ON recordings;
CREATE POLICY recordings_scope_read ON recordings FOR SELECT USING (EXISTS (SELECT 1 FROM devices d WHERE d.id = recordings.device_id AND app_has_scope_access(recordings.organization_id, d.neighborhood_id, d.property_id)));
DROP POLICY IF EXISTS consents_self_read ON consents;
CREATE POLICY consents_self_read ON consents FOR SELECT USING (user_id = app_current_user_id());

REVOKE ALL ON access_invitations FROM PUBLIC;
COMMENT ON FUNCTION claim_my_invited_access() IS 'Claims tenant access only for an authenticated Neon Auth user with verified email and a valid pending invitation.';

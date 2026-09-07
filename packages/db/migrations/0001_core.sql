CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE alert_severity AS ENUM ('informational','attention','high','critical');
CREATE TYPE device_status AS ENUM ('online','offline','degraded','maintenance');
CREATE TYPE device_type AS ENUM ('camera','sensor','gateway','nvr','gps','siren','panic');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  document_hash text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE neighborhoods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  municipality text,
  state_code char(2),
  boundary geometry(MultiPolygon, 4326),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  name text NOT NULL,
  municipality text,
  state_code char(2),
  centroid geography(Point,4326),
  boundary geometry(MultiPolygon,4326),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  property_id uuid NOT NULL REFERENCES properties(id),
  name text NOT NULL,
  area_type text,
  boundary geometry(MultiPolygon,4326),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_auth_id text UNIQUE,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'invited',
  mfa_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  property_id uuid REFERENCES properties(id),
  user_id uuid NOT NULL REFERENCES app_users(id),
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, role, neighborhood_id, property_id)
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  property_id uuid REFERENCES properties(id),
  area_id uuid REFERENCES areas(id),
  device_type device_type NOT NULL,
  name text NOT NULL,
  manufacturer text,
  model text,
  serial_number text,
  firmware_version text,
  status device_status NOT NULL DEFAULT 'offline',
  community_shared boolean NOT NULL DEFAULT false,
  location geography(Point,4326),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, serial_number)
);

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  property_id uuid REFERENCES properties(id),
  name text NOT NULL,
  asset_type text NOT NULL,
  external_identifier text,
  device_id uuid REFERENCES devices(id),
  location geography(Point,4326),
  geofence geometry(Polygon,4326),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  property_id uuid REFERENCES properties(id),
  device_id uuid REFERENCES devices(id),
  asset_id uuid REFERENCES assets(id),
  event_type text NOT NULL,
  severity alert_severity NOT NULL DEFAULT 'informational',
  confidence numeric(5,4),
  human_validation_status text NOT NULL DEFAULT 'pending',
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  property_id uuid REFERENCES properties(id),
  title text NOT NULL,
  severity alert_severity NOT NULL,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  responsible_user_id uuid REFERENCES app_users(id),
  summary text
);

CREATE TABLE incident_events (
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES security_events(id),
  PRIMARY KEY (incident_id, event_id)
);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  event_id uuid REFERENCES security_events(id),
  incident_id uuid REFERENCES incidents(id),
  severity alert_severity NOT NULL,
  channel text NOT NULL,
  recipient_user_id uuid REFERENCES app_users(id),
  status text NOT NULL DEFAULT 'queued',
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  incident_id uuid REFERENCES incidents(id),
  event_id uuid REFERENCES security_events(id),
  evidence_type text NOT NULL,
  storage_key text NOT NULL,
  sha256 text,
  captured_at timestamptz,
  retained_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  storage_key text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  retained_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid REFERENCES app_users(id),
  purpose text NOT NULL,
  legal_basis text,
  granted boolean NOT NULL,
  version text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  organization_id uuid,
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  request_id text,
  ip_hash text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_neighborhoods_org ON neighborhoods(organization_id);
CREATE INDEX idx_properties_org ON properties(organization_id);
CREATE INDEX idx_properties_neighborhood ON properties(neighborhood_id);
CREATE INDEX idx_devices_org_status ON devices(organization_id,status);
CREATE INDEX idx_devices_property ON devices(property_id);
CREATE INDEX idx_events_org_time ON security_events(organization_id,occurred_at DESC);
CREATE INDEX idx_events_device_time ON security_events(device_id,occurred_at DESC);
CREATE INDEX idx_incidents_org_status ON incidents(organization_id,status);
CREATE INDEX idx_alerts_org_created ON alerts(organization_id,created_at DESC);
CREATE INDEX idx_audit_org_time ON audit_logs(organization_id,occurred_at DESC);

COMMENT ON TABLE security_events IS 'IA/eventos são sinais operacionais e exigem validação humana quando aplicável, não constituem prova definitiva.';

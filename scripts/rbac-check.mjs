import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const compact = (text) => text.replace(/\s+/g, ' ').trim();
const fail = (message) => {
  console.error(`RBAC invariant check failed: ${message}`);
  process.exit(1);
};
const requireInvariant = (condition, message) => {
  if (!condition) fail(message);
};

const rural = compact(read('packages/db/migrations/0003_rural_structure.sql'));
const devices = compact(read('packages/db/migrations/0004_areas_devices.sql'));
const telemetry = compact(read('packages/db/migrations/0006_device_telemetry.sql'));
const community = compact(read('packages/db/migrations/0015_community.sql'));
const operations = compact(read('packages/db/migrations/0016_operations_soc.sql'));
const hardening = compact(read('packages/db/migrations/0017_stage_security_hardening.sql'));

const propertyManager = devices.match(/CREATE OR REPLACE FUNCTION app_can_manage_property[\s\S]*?\$\$;/)?.[0] ?? '';

requireInvariant(
  rural.includes("(p_property_id IS NOT NULL AND m.property_id = p_property_id)") &&
    rural.includes("(p_property_id IS NULL AND p_neighborhood_id IS NOT NULL AND m.neighborhood_id = p_neighborhood_id)"),
  'property access must require exact property scope while neighborhood access applies only when property_id is null.'
);

requireInvariant(propertyManager.length > 0, 'app_can_manage_property must exist.');
requireInvariant(
  propertyManager.includes("m.role = 'admin_organization'") && propertyManager.includes("m.role IN ('owner','technician')"),
  'private property management roles changed unexpectedly.'
);
requireInvariant(
  !propertyManager.includes("'admin_neighborhood'"),
  'admin_neighborhood must never inherit private property management.'
);

requireInvariant(
  telemetry.includes('REVOKE EXECUTE ON FUNCTION public.ingest_device_heartbeat') &&
    telemetry.includes('FROM public,authenticated,anonymous') &&
    !telemetry.includes('GRANT EXECUTE ON FUNCTION public.ingest_device_heartbeat'),
  'device heartbeat ingestion must remain unavailable to normal portal roles.'
);

requireInvariant(
  community.includes('private_device_sharing_allowed boolean NOT NULL DEFAULT false CHECK (private_device_sharing_allowed=false)') &&
    community.includes("'private_device_sharing_allowed',false"),
  'Community must keep private device sharing permanently disabled in the MVP.'
);

requireInvariant(
  community.includes('d.property_id IS NULL') && community.includes('d.community_shared=true') && community.includes("d.device_type='camera'"),
  'path-to-property route points must remain restricted to community cameras.'
);

requireInvariant(
  operations.includes("'human_monitoring_assumed',false,'public_dispatch_enabled',false"),
  'Operations/SOC must not imply contracted human monitoring or public dispatch.'
);

for (const table of ['spatial_ref_sys', 'geometry_columns', 'geography_columns']) {
  requireInvariant(
    hardening.includes(`REVOKE INSERT, UPDATE, DELETE ON TABLE public.${table} FROM authenticated`),
    `authenticated must not write PostGIS metadata table ${table}.`
  );
}

console.log('RBAC invariant check passed: private/community separation, ingestion boundary, SOC flags and PostGIS hardening preserved.');

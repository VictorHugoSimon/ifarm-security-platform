import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0019_access_invitations.sql', 'utf8').replace(/\s+/g, ' ');
const fail = (message) => {
  console.error(`Access invitation check failed: ${message}`);
  process.exit(1);
};
const requireInvariant = (condition, message) => {
  if (!condition) fail(message);
};

for (const forbidden of ['admin_ifarm', 'authorized_authority', 'insurance_partner']) {
  requireInvariant(
    migration.includes(`v_role IN ('admin_ifarm','authorized_authority','insurance_partner')`),
    'sensitive roles must be rejected by the generic invitation RPC.'
  );
  requireInvariant(
    migration.includes('invitation_role_requires_separate_onboarding'),
    'sensitive roles must route to separate onboarding.'
  );
  requireInvariant(
    migration.includes("role IN ( 'admin_organization', 'admin_neighborhood', 'owner', 'family', 'employee', 'technician', 'monitoring' )"),
    `table-level invitation role constraint must exclude ${forbidden}.`
  );
}

requireInvariant(
  migration.includes("p_property_id IS NULL AND p_neighborhood_id IS NOT NULL AND p_role IN ('technician','monitoring')") &&
    migration.includes("m.property_id IS NULL AND m.role = 'admin_neighborhood'"),
  'admin_neighborhood delegation must remain community-only and never inherit private property scope.'
);

requireInvariant(
  migration.includes("p_property_id IS NOT NULL AND p_role IN ('family','employee','technician','monitoring')") &&
    migration.includes("m.property_id = p_property_id AND m.role = 'owner'"),
  'owner delegation must stay limited to operational roles on the exact property.'
);

requireInvariant(
  migration.includes("WHEN p_role = 'admin_organization' THEN false"),
  'non-platform actors must never delegate admin_organization.'
);
requireInvariant(
  migration.includes('WHEN public.app_is_platform_admin() THEN true'),
  'platform admin remains the only path that can delegate admin_organization.'
);

requireInvariant(
  migration.includes('NULLS NOT DISTINCT') && migration.includes("WHERE status = 'pending'"),
  'pending invitation uniqueness must cover nullable scopes.'
);
requireInvariant(
  migration.includes("p_expires_at > now() + interval '30 days'") && migration.includes("p_expires_at <= now() + interval '15 minutes'"),
  'invitation expiration must remain bounded between 15 minutes and 30 days.'
);
requireInvariant(
  migration.includes("encode(digest(v_email, 'sha256'), 'hex')") &&
    migration.includes("encode(digest(lower(v_inv.email), 'sha256'), 'hex')"),
  'audit logs must hash invitation email identifiers.'
);

requireInvariant(
  migration.includes('REVOKE ALL ON TABLE public.access_invitations FROM PUBLIC, anonymous, authenticated'),
  'invitation PII table must have no direct browser surface.'
);
requireInvariant(
  migration.includes('REVOKE ALL ON FUNCTION public.app_can_delegate_invitation(uuid,uuid,uuid,text) FROM PUBLIC, anonymous, authenticated'),
  'delegation helper must remain internal.'
);

for (const signature of [
  'public.create_access_invitation(uuid,text,text,uuid,uuid,timestamptz)',
  'public.list_access_invitations(uuid)',
  'public.revoke_access_invitation(uuid)',
  'public.claim_my_invited_access()'
]) {
  requireInvariant(
    migration.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated`),
    `${signature} must be granted only to authenticated.`
  );
}

requireInvariant(
  migration.includes("AND i.role IN ( 'admin_organization','admin_neighborhood','owner','family','employee','technician','monitoring' )") ||
    migration.includes("AND i.role IN ( 'admin_organization', 'admin_neighborhood', 'owner', 'family', 'employee', 'technician', 'monitoring' )"),
  'claim path must explicitly exclude sensitive roles.'
);

console.log('Access invitation check passed: scoped delegation, sensitive-role separation, PII isolation and authenticated-only RPCs preserved.');

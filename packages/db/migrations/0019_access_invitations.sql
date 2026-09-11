-- SEC-175 — administração segura de convites e delegação de acesso.
-- Aplicar DEV -> STAGE. PROD permanece fora desta fase.
-- Convite genérico é somente para papéis tenant. admin_ifarm, autoridade autorizada
-- e parceiro de seguro exigem fluxos separados e não podem ser delegados por esta superfície.

ALTER TABLE public.access_invitations
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by_user_id uuid REFERENCES public.app_users(id);

ALTER TABLE public.access_invitations
  DROP CONSTRAINT IF EXISTS access_invitations_role_check;

ALTER TABLE public.access_invitations
  ADD CONSTRAINT access_invitations_role_check CHECK (
    role IN (
      'admin_organization',
      'admin_neighborhood',
      'owner',
      'family',
      'employee',
      'technician',
      'monitoring'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_access_invitations_pending_scope
  ON public.access_invitations (
    organization_id,
    neighborhood_id,
    property_id,
    lower(email),
    role
  ) NULLS NOT DISTINCT
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.app_can_delegate_invitation(
  p_organization_id uuid,
  p_neighborhood_id uuid,
  p_property_id uuid,
  p_role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN p_role NOT IN (
      'admin_organization',
      'admin_neighborhood',
      'owner',
      'family',
      'employee',
      'technician',
      'monitoring'
    ) THEN false

    -- Somente Admin iFarm pode conceder o primeiro/novo Admin Organização.
    WHEN public.app_is_platform_admin() THEN true
    WHEN p_role = 'admin_organization' THEN false

    -- Admin Organização pode delegar papéis tenant abaixo do seu nível.
    WHEN EXISTS (
      SELECT 1
      FROM public.memberships m
      JOIN public.app_users u ON u.id = m.user_id
      WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
        AND u.status = 'active'
        AND m.status = 'active'
        AND m.organization_id = p_organization_id
        AND m.role = 'admin_organization'
    ) THEN true

    -- Admin Bairro pode delegar somente operação comunitária, nunca propriedade privada.
    WHEN p_property_id IS NULL
      AND p_neighborhood_id IS NOT NULL
      AND p_role IN ('technician','monitoring')
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
          AND m.role = 'admin_neighborhood'
      ) THEN true

    -- Proprietário pode delegar somente papéis operacionais dentro da própria propriedade.
    WHEN p_property_id IS NOT NULL
      AND p_role IN ('family','employee','technician','monitoring')
      AND EXISTS (
        SELECT 1
        FROM public.memberships m
        JOIN public.app_users u ON u.id = m.user_id
        WHERE u.auth_user_id = NULLIF(auth.user_id(), '')::uuid
          AND u.status = 'active'
          AND m.status = 'active'
          AND m.organization_id = p_organization_id
          AND m.property_id = p_property_id
          AND m.role = 'owner'
      ) THEN true

    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.create_access_invitation(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_neighborhood_id uuid DEFAULT NULL,
  p_property_id uuid DEFAULT NULL,
  p_expires_at timestamptz DEFAULT (now() + interval '7 days')
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_actor uuid;
  v_email text := lower(trim(p_email));
  v_role text := lower(trim(p_role));
  v_neighborhood_id uuid := p_neighborhood_id;
  v_property_neighborhood_id uuid;
BEGIN
  IF NULLIF(v_email, '') IS NULL
     OR length(v_email) > 254
     OR v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_invitation_email';
  END IF;

  IF v_role IN ('admin_ifarm','authorized_authority','insurance_partner') THEN
    RAISE EXCEPTION 'invitation_role_requires_separate_onboarding';
  END IF;

  IF v_role NOT IN (
    'admin_organization','admin_neighborhood','owner','family','employee','technician','monitoring'
  ) THEN
    RAISE EXCEPTION 'invitation_role_not_allowed';
  END IF;

  IF p_expires_at IS NULL
     OR p_expires_at <= now() + interval '15 minutes'
     OR p_expires_at > now() + interval '30 days' THEN
    RAISE EXCEPTION 'invalid_invitation_expiration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = p_organization_id AND o.status = 'active'
  ) THEN
    RAISE EXCEPTION 'organization_not_found';
  END IF;

  IF p_property_id IS NOT NULL THEN
    SELECT p.neighborhood_id
      INTO v_property_neighborhood_id
      FROM public.properties p
     WHERE p.id = p_property_id
       AND p.organization_id = p_organization_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'property_scope_mismatch';
    END IF;

    IF p_neighborhood_id IS NOT NULL
       AND p_neighborhood_id IS DISTINCT FROM v_property_neighborhood_id THEN
      RAISE EXCEPTION 'neighborhood_scope_mismatch';
    END IF;

    v_neighborhood_id := v_property_neighborhood_id;
  ELSIF p_neighborhood_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.neighborhoods n
      WHERE n.id = p_neighborhood_id
        AND n.organization_id = p_organization_id
    ) THEN
      RAISE EXCEPTION 'neighborhood_scope_mismatch';
    END IF;
  END IF;

  IF v_role = 'admin_organization'
     AND (v_neighborhood_id IS NOT NULL OR p_property_id IS NOT NULL) THEN
    RAISE EXCEPTION 'admin_organization_requires_org_scope';
  END IF;

  IF v_role = 'admin_neighborhood'
     AND (v_neighborhood_id IS NULL OR p_property_id IS NOT NULL) THEN
    RAISE EXCEPTION 'admin_neighborhood_requires_neighborhood_scope';
  END IF;

  IF v_role IN ('owner','family','employee') AND p_property_id IS NULL THEN
    RAISE EXCEPTION 'role_requires_property_scope';
  END IF;

  IF v_role IN ('technician','monitoring')
     AND p_property_id IS NULL
     AND v_neighborhood_id IS NULL THEN
    RAISE EXCEPTION 'role_requires_neighborhood_or_property_scope';
  END IF;

  IF NOT public.app_can_delegate_invitation(
    p_organization_id,
    v_neighborhood_id,
    p_property_id,
    v_role
  ) THEN
    RAISE EXCEPTION 'invitation_delegation_not_allowed';
  END IF;

  IF public.app_is_platform_admin() THEN
    v_actor := public.app_ensure_platform_user();
  ELSE
    v_actor := public.app_current_user_id();
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.app_users u
    JOIN public.memberships m ON m.user_id = u.id
    WHERE lower(u.email) = v_email
      AND u.status = 'active'
      AND m.status = 'active'
      AND m.organization_id = p_organization_id
      AND m.neighborhood_id IS NOT DISTINCT FROM v_neighborhood_id
      AND m.property_id IS NOT DISTINCT FROM p_property_id
      AND m.role = v_role
  ) THEN
    RAISE EXCEPTION 'membership_already_active';
  END IF;

  -- Libera a chave única quando o convite anterior do mesmo escopo já venceu.
  UPDATE public.access_invitations i
     SET status = 'expired'
   WHERE i.organization_id = p_organization_id
     AND i.neighborhood_id IS NOT DISTINCT FROM v_neighborhood_id
     AND i.property_id IS NOT DISTINCT FROM p_property_id
     AND lower(i.email) = v_email
     AND i.role = v_role
     AND i.status = 'pending'
     AND i.expires_at <= now();

  BEGIN
    INSERT INTO public.access_invitations(
      organization_id,
      neighborhood_id,
      property_id,
      email,
      role,
      status,
      expires_at,
      created_by_user_id
    )
    VALUES (
      p_organization_id,
      v_neighborhood_id,
      p_property_id,
      v_email,
      v_role,
      'pending',
      p_expires_at,
      v_actor
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'invitation_already_pending';
  END;

  INSERT INTO public.audit_logs(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    p_organization_id,
    v_actor,
    'access.invitation.created',
    'access_invitation',
    v_id::text,
    jsonb_build_object(
      'email_sha256', encode(digest(v_email, 'sha256'), 'hex'),
      'role', v_role,
      'neighborhood_id', v_neighborhood_id,
      'property_id', p_property_id,
      'expires_at', p_expires_at
    )
  );

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.list_access_invitations(
  p_organization_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  organization_name text,
  neighborhood_id uuid,
  neighborhood_name text,
  property_id uuid,
  property_name text,
  email text,
  role text,
  status text,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    i.id,
    i.organization_id,
    o.name AS organization_name,
    i.neighborhood_id,
    n.name AS neighborhood_name,
    i.property_id,
    p.name AS property_name,
    i.email,
    i.role,
    CASE
      WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired'
      ELSE i.status
    END AS status,
    i.expires_at,
    i.accepted_at,
    i.revoked_at,
    i.created_at
  FROM public.access_invitations i
  JOIN public.organizations o ON o.id = i.organization_id
  LEFT JOIN public.neighborhoods n ON n.id = i.neighborhood_id
  LEFT JOIN public.properties p ON p.id = i.property_id
  WHERE (p_organization_id IS NULL OR i.organization_id = p_organization_id)
    AND public.app_can_delegate_invitation(
      i.organization_id,
      i.neighborhood_id,
      i.property_id,
      i.role
    )
  ORDER BY i.created_at DESC
  LIMIT 200
$$;

CREATE OR REPLACE FUNCTION public.revoke_access_invitation(
  p_invitation_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_inv public.access_invitations%ROWTYPE;
  v_actor uuid;
BEGIN
  SELECT * INTO v_inv
  FROM public.access_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found';
  END IF;

  IF v_inv.status <> 'pending' OR v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation_not_pending';
  END IF;

  IF NOT public.app_can_delegate_invitation(
    v_inv.organization_id,
    v_inv.neighborhood_id,
    v_inv.property_id,
    v_inv.role
  ) THEN
    RAISE EXCEPTION 'invitation_delegation_not_allowed';
  END IF;

  IF public.app_is_platform_admin() THEN
    v_actor := public.app_ensure_platform_user();
  ELSE
    v_actor := public.app_current_user_id();
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  UPDATE public.access_invitations
     SET status = 'revoked',
         revoked_at = now(),
         revoked_by_user_id = v_actor
   WHERE id = p_invitation_id;

  INSERT INTO public.audit_logs(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    v_inv.organization_id,
    v_actor,
    'access.invitation.revoked',
    'access_invitation',
    v_inv.id::text,
    jsonb_build_object(
      'email_sha256', encode(digest(lower(v_inv.email), 'sha256'), 'hex'),
      'role', v_inv.role,
      'neighborhood_id', v_inv.neighborhood_id,
      'property_id', v_inv.property_id
    )
  );

  RETURN p_invitation_id;
END
$$;

-- Defesa adicional no claim: mesmo uma linha legada/manualmente criada fora da constraint
-- nunca pode converter admin_ifarm, autoridade ou parceiro de seguro em membership genérica.
CREATE OR REPLACE FUNCTION public.claim_my_invited_access()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, neon_auth
AS $$
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
    SELECT 1 FROM public.access_invitations i
    WHERE lower(i.email) = lower(v_email)
      AND i.status = 'pending'
      AND i.expires_at > now()
      AND i.role IN (
        'admin_organization','admin_neighborhood','owner','family','employee','technician','monitoring'
      )
  ) THEN RAISE EXCEPTION 'valid_invitation_required'; END IF;

  INSERT INTO public.app_users(auth_user_id, external_auth_id, full_name, email, status, mfa_required)
  VALUES (v_auth_user, v_auth_user::text, v_name, lower(v_email), 'active', true)
  ON CONFLICT (auth_user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, status = 'active'
  RETURNING id INTO v_app_user;

  INSERT INTO public.memberships(organization_id, neighborhood_id, property_id, user_id, role, status)
  SELECT i.organization_id, i.neighborhood_id, i.property_id, v_app_user, i.role, 'active'
  FROM public.access_invitations i
  WHERE lower(i.email) = lower(v_email)
    AND i.status = 'pending'
    AND i.expires_at > now()
    AND i.role IN (
      'admin_organization','admin_neighborhood','owner','family','employee','technician','monitoring'
    )
  ON CONFLICT DO NOTHING;

  UPDATE public.access_invitations
     SET status = 'accepted', accepted_at = now()
   WHERE lower(email) = lower(v_email)
     AND status = 'pending'
     AND expires_at > now()
     AND role IN (
       'admin_organization','admin_neighborhood','owner','family','employee','technician','monitoring'
     );

  RETURN v_app_user;
END
$$;

-- Convites são PII e não possuem superfície direta no Data API.
REVOKE ALL ON TABLE public.access_invitations FROM PUBLIC, anonymous, authenticated;

-- Helper interno não é RPC pública, nem mesmo para authenticated.
REVOKE ALL ON FUNCTION public.app_can_delegate_invitation(uuid,uuid,uuid,text)
  FROM PUBLIC, anonymous, authenticated;

-- Somente as RPCs explicitamente aprovadas ficam acessíveis ao role autenticado.
REVOKE ALL ON FUNCTION public.create_access_invitation(uuid,text,text,uuid,uuid,timestamptz)
  FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.list_access_invitations(uuid)
  FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.revoke_access_invitation(uuid)
  FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.claim_my_invited_access()
  FROM PUBLIC, anonymous, authenticated;

GRANT EXECUTE ON FUNCTION public.create_access_invitation(uuid,text,text,uuid,uuid,timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_access_invitations(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_access_invitation(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_invited_access()
  TO authenticated;

COMMENT ON FUNCTION public.create_access_invitation(uuid,text,text,uuid,uuid,timestamptz)
  IS 'Creates an audited, time-limited tenant invitation with server-enforced delegation and scope rules. Generic invitations never grant admin_ifarm, authorized_authority or insurance_partner.';
COMMENT ON FUNCTION public.list_access_invitations(uuid)
  IS 'Lists only invitations the current actor is currently authorized to manage. Expired pending invitations are presented as expired without direct table exposure.';
COMMENT ON FUNCTION public.revoke_access_invitation(uuid)
  IS 'Revokes a pending invitation only when the current actor is authorized to delegate that same role and scope.';

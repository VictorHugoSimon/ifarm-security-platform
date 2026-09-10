-- SEC-172 — least-privilege hardening for browser roles and application RPCs.
-- Apply DEV -> STAGE. PROD remains outside this phase.
-- Preserves the authenticated function surface that existed before this migration,
-- closes anonymous execution of iFarm Security functions and removes direct browser DML.

DO $sec172$
DECLARE
  r record;
  v_auth_exists boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  v_anon_exists boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anonymous');
  v_auth_exec boolean;
BEGIN
  -- These five controlled RPCs perform writes after explicit scope checks. Convert them
  -- to SECURITY DEFINER before removing direct DML grants from browser roles.
  ALTER FUNCTION public.register_device_ingest_key(uuid,text,text,timestamptz) SECURITY DEFINER;
  ALTER FUNCTION public.revoke_device_ingest_key(uuid) SECURITY DEFINER;
  ALTER FUNCTION public.set_property_location(uuid,double precision,double precision) SECURITY DEFINER;
  ALTER FUNCTION public.set_property_boundary(uuid,jsonb) SECURITY DEFINER;
  ALTER FUNCTION public.set_area_boundary(uuid,jsonb) SECURITY DEFINER;

  IF v_auth_exists THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated';
  END IF;
  IF v_anon_exists THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anonymous';
  END IF;

  -- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. For every
  -- non-extension function owned by this application, preserve the pre-existing
  -- authenticated effective EXECUTE and remove PUBLIC/anonymous access.
  FOR r IN
    SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        JOIN pg_extension e ON e.oid = d.refobjid
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
  LOOP
    IF v_auth_exists THEN
      v_auth_exec := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    ELSE
      v_auth_exec := false;
    END IF;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC', r.nspname, r.proname, r.identity_args);
    IF v_anon_exists THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM anonymous', r.nspname, r.proname, r.identity_args);
    END IF;
    IF v_auth_exec THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated', r.nspname, r.proname, r.identity_args);
    END IF;
  END LOOP;

  -- Future functions/tables created by the migration owner must not silently reopen
  -- anonymous function execution or direct browser writes.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC';
  IF v_auth_exists THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated';
  END IF;
  IF v_anon_exists THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anonymous';
  END IF;
END
$sec172$;

-- SEC-140 — hardening compartilhado DEV/STAGE antes do aceite de promoção.
-- Remove utilitário de diagnóstico que não pertence à superfície do produto e
-- restringe escrita do role authenticated nos catálogos/metadados PostGIS.

DROP FUNCTION IF EXISTS public.show_db_tree();

REVOKE INSERT, UPDATE, DELETE ON TABLE public.spatial_ref_sys FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.geometry_columns FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.geography_columns FROM authenticated;

GRANT SELECT ON TABLE public.spatial_ref_sys TO authenticated;
GRANT SELECT ON TABLE public.geometry_columns TO authenticated;
GRANT SELECT ON TABLE public.geography_columns TO authenticated;

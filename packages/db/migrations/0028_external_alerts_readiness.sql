-- SEC-189 — External Alerts Provider Readiness.
-- External channels remain fail-closed until an explicit dispatcher/provider migration is reviewed and promoted.

ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS provider_key text,
  ADD COLUMN IF NOT EXISTS delivery_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_attempt_count_nonnegative
    CHECK (attempt_count >= 0),
  ADD CONSTRAINT alerts_provider_key_length
    CHECK (provider_key IS NULL OR length(provider_key) BETWEEN 1 AND 80),
  ADD CONSTRAINT alerts_provider_message_id_length
    CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 255),
  ADD CONSTRAINT alerts_last_error_length
    CHECK (last_error IS NULL OR length(last_error) <= 1000),
  ADD CONSTRAINT alerts_external_delivery_fail_closed
    CHECK (
      channel = 'app'
      OR (
        channel IN ('push','email','sms','whatsapp')
        AND status = 'blocked_external'
        AND provider_key IS NULL
        AND provider_message_id IS NULL
        AND sent_at IS NULL
        AND delivery_started_at IS NULL
        AND last_attempt_at IS NULL
      )
    );

CREATE TABLE public.alert_delivery_providers (
  channel text PRIMARY KEY CHECK (channel IN ('push','email','sms','whatsapp')),
  provider_key text,
  mode text NOT NULL DEFAULT 'blocked' CHECK (mode IN ('blocked','test','live')),
  enabled boolean NOT NULL DEFAULT false,
  sender_reference text,
  configuration_note text,
  configured_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider_key IS NULL OR length(provider_key) BETWEEN 1 AND 80),
  CHECK (sender_reference IS NULL OR length(sender_reference) <= 160),
  CHECK (configuration_note IS NULL OR length(configuration_note) <= 1000),
  CHECK (
    (mode = 'blocked' AND enabled = false)
    OR (mode IN ('test','live') AND enabled = true AND provider_key IS NOT NULL AND configured_at IS NOT NULL)
  )
);

INSERT INTO public.alert_delivery_providers(channel, provider_key, mode, enabled, configuration_note)
VALUES
  ('push', NULL, 'blocked', false, 'Provider não homologado.'),
  ('email', NULL, 'blocked', false, 'Provider não homologado.'),
  ('sms', NULL, 'blocked', false, 'Provider não homologado.'),
  ('whatsapp', NULL, 'blocked', false, 'Somente provider/API oficial homologado; nenhuma integração pública presumida.')
ON CONFLICT (channel) DO NOTHING;

ALTER TABLE public.alert_delivery_providers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alert_delivery_providers FROM PUBLIC, anonymous, authenticated;

CREATE OR REPLACE FUNCTION public.get_external_alert_provider_status()
RETURNS TABLE (
  channel text,
  configured boolean,
  mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.channel,
         (p.enabled AND p.mode IN ('test','live') AND p.provider_key IS NOT NULL) AS configured,
         p.mode
  FROM public.alert_delivery_providers p
  ORDER BY CASE p.channel
    WHEN 'push' THEN 1
    WHEN 'email' THEN 2
    WHEN 'sms' THEN 3
    WHEN 'whatsapp' THEN 4
    ELSE 99 END
$$;

REVOKE ALL ON FUNCTION public.get_external_alert_provider_status()
  FROM PUBLIC, anonymous;
GRANT EXECUTE ON FUNCTION public.get_external_alert_provider_status()
  TO authenticated;

COMMENT ON TABLE public.alert_delivery_providers IS
'Provider metadata only. No credentials or secrets are stored here. External delivery remains blocked by alerts_external_delivery_fail_closed until a future dispatcher migration explicitly changes the contract.';

COMMENT ON FUNCTION public.get_external_alert_provider_status() IS
'Sanitized provider readiness only; returns no credentials, sender secrets, tokens, phone numbers or configuration payloads.';

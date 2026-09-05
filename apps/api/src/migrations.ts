export const migrations = `
CREATE TABLE IF NOT EXISTS device_installations (
  id uuid PRIMARY KEY, public_key_pem text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), account_id uuid
);
CREATE TABLE IF NOT EXISTS channel_pairing_sessions (
  id uuid PRIMARY KEY, channel text NOT NULL CHECK (channel IN ('telegram','feishu')), device_installation_id uuid NOT NULL REFERENCES device_installations(id),
  token_hash text NOT NULL UNIQUE, status text NOT NULL, failure_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  scanned_at timestamptz, confirmed_at timestamptz, consumed_at timestamptz, cancelled_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pairing_device ON channel_pairing_sessions(device_installation_id, created_at DESC);
CREATE TABLE IF NOT EXISTS channel_bindings (
  id uuid PRIMARY KEY, channel text NOT NULL, channel_user_id text NOT NULL, chat_id text NOT NULL, account_id uuid, device_installation_id uuid NOT NULL REFERENCES device_installations(id),
  scope text NOT NULL CHECK (scope IN ('direct','group')), status text NOT NULL, created_at timestamptz NOT NULL, last_verified_at timestamptz NOT NULL, revoked_at timestamptz,
  UNIQUE(channel, channel_user_id, chat_id)
);
CREATE INDEX IF NOT EXISTS idx_binding_device ON channel_bindings(device_installation_id, status);
CREATE TABLE IF NOT EXISTS channel_events (
  id uuid PRIMARY KEY, channel text NOT NULL, provider_event_id text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), UNIQUE(channel, provider_event_id)
);
CREATE TABLE IF NOT EXISTS channel_deliveries (
  id uuid PRIMARY KEY, binding_id uuid NOT NULL REFERENCES channel_bindings(id), device_installation_id uuid NOT NULL REFERENCES device_installations(id), envelope jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','delivered','acked','expired')), task_id text, error text, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  delivered_at timestamptz, acked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_delivery_pull ON channel_deliveries(device_installation_id, status, created_at);
CREATE TABLE IF NOT EXISTS channel_outbound_messages (
  id uuid PRIMARY KEY, delivery_id uuid NOT NULL REFERENCES channel_deliveries(id), status_key text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', attempt integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(delivery_id, status_key)
);
CREATE TABLE IF NOT EXISTS model_gateway_sessions (
  id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, device_installation_id uuid NOT NULL REFERENCES device_installations(id),
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, last_used_at timestamptz, revoked_at timestamptz,
  request_count integer NOT NULL DEFAULT 0, max_requests integer NOT NULL DEFAULT 1000
);
CREATE INDEX IF NOT EXISTS idx_model_gateway_device ON model_gateway_sessions(device_installation_id, expires_at DESC);
ALTER TABLE model_gateway_sessions ADD COLUMN IF NOT EXISTS client_version text NOT NULL DEFAULT '0.1.0';
CREATE TABLE IF NOT EXISTS model_routes (
  id uuid PRIMARY KEY, logical_model_id text NOT NULL, display_name text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('volcengine-ark')), provider_model_id text NOT NULL, endpoint text NOT NULL,
  capabilities jsonb NOT NULL, input_price_microunits_per_million bigint NOT NULL CHECK (input_price_microunits_per_million >= 0),
  output_price_microunits_per_million bigint NOT NULL CHECK (output_price_microunits_per_million >= 0),
  cache_price_microunits_per_million bigint NOT NULL CHECK (cache_price_microunits_per_million >= 0),
  context_limit integer NOT NULL CHECK (context_limit >= 1024), output_limit integer NOT NULL CHECK (output_limit >= 256 AND output_limit <= context_limit),
  enabled boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 100, health text NOT NULL CHECK (health IN ('healthy','degraded','disabled')),
  fallback_priority integer NOT NULL DEFAULT 100, minimum_client_version text NOT NULL, version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(logical_model_id,provider_model_id)
);
CREATE INDEX IF NOT EXISTS idx_model_route_resolution ON model_routes(logical_model_id,enabled,health,sort_order,fallback_priority);
CREATE TABLE IF NOT EXISTS public_config_versions (
  version bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, config jsonb NOT NULL, etag text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_idempotency_keys (
  key text PRIMARY KEY, operation text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_audit_events (
  id uuid PRIMARY KEY, actor text NOT NULL, action text NOT NULL, resource text NOT NULL, idempotency_key text,
  before_version bigint, after_version bigint, summary jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_events(created_at DESC);
`;

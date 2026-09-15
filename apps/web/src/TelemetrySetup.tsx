import { useEffect, useState } from 'react';
import { neon } from './lib/neon';
import './telemetry.css';

type DeviceHealth = {
  device_id: string;
  name: string;
  device_type: string;
  scope: string;
  status: string;
  last_seen_at: string | null;
  seconds_since_last_seen: number | null;
  expected_heartbeat_seconds: number;
  offline_after_seconds: number;
  battery_pct: number | string | null;
  signal_rssi: number | null;
  connection_type: string | null;
};

type IngestKey = {
  id: string;
  label: string | null;
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
  rotated_from_key_id?: string | null;
};

function base64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function ageLabel(seconds: number | null) {
  if (seconds === null) return 'nunca visto';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function keyStatusLabel(status: string) {
  if (status === 'retiring') return 'em rotação';
  if (status === 'expired') return 'expirada';
  if (status === 'revoked') return 'revogada';
  return 'ativa';
}

function newRawDeviceKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `ifs_${base64Url(bytes)}`;
}

export function TelemetrySetup() {
  const [health, setHealth] = useState<DeviceHealth[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [keys, setKeys] = useState<IngestKey[]>([]);
  const [label, setLabel] = useState('gateway principal');
  const [generatedKey, setGeneratedKey] = useState('');
  const [rotationOverlapMinutes, setRotationOverlapMinutes] = useState(60);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadHealth() {
    const result = await neon.rpc('get_device_health');
    if (result.error) return setMessage('Não foi possível carregar a saúde dos dispositivos.');
    const rows = (result.data || []) as DeviceHealth[];
    setHealth(rows);
    setSelectedDevice((current) => current || rows[0]?.device_id || '');
  }

  async function loadKeys(deviceId: string) {
    if (!deviceId) { setKeys([]); return; }
    const result = await neon.rpc('list_device_ingest_keys', { p_device_id: deviceId });
    if (result.error) { setKeys([]); return; }
    setKeys((result.data || []) as IngestKey[]);
  }

  async function generateKey() {
    if (!selectedDevice) return;
    setSaving(true); setMessage(''); setGeneratedKey('');
    try {
      const rawKey = newRawDeviceKey();
      const hash = await sha256Hex(rawKey);
      const result = await neon.rpc('register_device_ingest_key', {
        p_device_id: selectedDevice,
        p_key_hash: hash,
        p_label: label || null,
        p_expires_at: null
      });
      if (result.error) {
        setMessage(result.error.message.includes('active_key_limit_reached') ? 'Este dispositivo já atingiu o limite de chaves ativas.' : 'Seu perfil não pode gerar a chave deste dispositivo.');
        return;
      }
      setGeneratedKey(rawKey);
      setMessage('Chave criada. Copie agora: o valor bruto não é armazenado no banco.');
      await loadKeys(selectedDevice);
    } finally { setSaving(false); }
  }

  async function rotateKey(predecessorKeyId: string) {
    if (!selectedDevice) return;
    setSaving(true); setMessage(''); setGeneratedKey('');
    try {
      const rawKey = newRawDeviceKey();
      const hash = await sha256Hex(rawKey);
      const result = await neon.rpc('rotate_device_ingest_key', {
        p_device_id: selectedDevice,
        p_predecessor_key_id: predecessorKeyId,
        p_new_key_hash: hash,
        p_label: label || 'rotação',
        p_new_expires_at: null,
        p_overlap_minutes: rotationOverlapMinutes
      });
      if (result.error) {
        const text = result.error.message || '';
        if (text.includes('predecessor_already_rotated')) setMessage('Esta chave já iniciou uma rotação. Aguarde a troca ou revogue-a.');
        else if (text.includes('active_key_limit_reached')) setMessage('Limite de chaves ativas atingido. Revogue uma chave antiga antes de rotacionar.');
        else setMessage('Não foi possível iniciar a rotação desta chave.');
        return;
      }
      setGeneratedKey(rawKey);
      setMessage(`Rotação iniciada. Configure a nova chave no dispositivo em até ${rotationOverlapMinutes} minutos; a chave anterior expirará automaticamente.`);
      await loadKeys(selectedDevice);
    } finally { setSaving(false); }
  }

  async function revokeKey(keyId: string) {
    setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('revoke_device_ingest_key', { p_key_id: keyId });
      if (result.error) return setMessage('Não foi possível revogar a chave.');
      setGeneratedKey('');
      setMessage('Chave revogada e auditada.');
      await loadKeys(selectedDevice);
    } finally { setSaving(false); }
  }

  async function copyKey() {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey);
      setMessage('Chave copiada. Configure-a somente no gateway/dispositivo autorizado.');
    } catch {
      setMessage('Não foi possível copiar automaticamente. Selecione o valor e copie manualmente.');
    }
  }

  useEffect(() => {
    void loadHealth();
    const interval = window.setInterval(() => { void loadHealth(); }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => { void loadKeys(selectedDevice); }, [selectedDevice]);

  const online = health.filter((item) => item.status === 'online').length;
  const degraded = health.filter((item) => item.status === 'degraded').length;
  const offline = health.filter((item) => item.status === 'offline').length;

  return (
    <section id="device-health">
      <div className="section-heading"><div><span className="eyebrow">SEC-023 / SEC-192</span><h2>Saúde e Telemetria</h2></div><div className="structure-counts"><span>{online} online</span><span>{degraded} degradados</span><span>{offline} offline</span></div></div>
      {message && <div className="structure-message">{message}</div>}
      <div className="telemetry-layout">
        <div className="telemetry-table-card">
          <div className="telemetry-card-head"><strong>Dispositivos autorizados</strong><button className="secondary" type="button" onClick={() => void loadHealth()}>Atualizar</button></div>
          <div className="telemetry-table-wrap"><table className="telemetry-table"><thead><tr><th>Dispositivo</th><th>Escopo</th><th>Status</th><th>Último sinal</th><th>Bateria</th><th>RSSI</th></tr></thead><tbody>{health.length ? health.map((item) => <tr key={item.device_id}><td><strong>{item.name}</strong><small>{item.device_type}</small></td><td>{item.scope}</td><td><span className={`health-badge health-${item.status}`}>{item.status}</span></td><td>{ageLabel(item.seconds_since_last_seen)}</td><td>{item.battery_pct === null ? '—' : `${Number(item.battery_pct).toFixed(0)}%`}</td><td>{item.signal_rssi === null ? '—' : `${item.signal_rssi} dBm`}</td></tr>) : <tr><td colSpan={6}>Nenhum dispositivo autorizado.</td></tr>}</tbody></table></div>
        </div>
        <div className="structure-card telemetry-key-card">
          <strong>Credenciais de ingestão</strong><p>Gere ou rotacione uma chave exclusiva por gateway/dispositivo. O banco guarda somente SHA-256 e nunca recupera o valor bruto.</p>
          <label>Dispositivo<select value={selectedDevice} onChange={(event) => { setSelectedDevice(event.target.value); setGeneratedKey(''); }}><option value="">Selecione</option>{health.map((item) => <option key={item.device_id} value={item.device_id}>{item.name}</option>)}</select></label>
          <label>Identificação<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} /></label>
          <label>Janela de rotação<select value={rotationOverlapMinutes} onChange={(event) => setRotationOverlapMinutes(Number(event.target.value))}><option value={15}>15 minutos</option><option value={60}>1 hora</option><option value={240}>4 horas</option><option value={1440}>24 horas</option></select></label>
          <button className="primary" type="button" disabled={saving || !selectedDevice} onClick={() => void generateKey()}>Gerar chave adicional</button>
          {generatedKey && <div className="generated-key"><small>EXIBIDA UMA ÚNICA VEZ</small><code>{generatedKey}</code><button className="secondary" type="button" onClick={() => void copyKey()}>Copiar</button></div>}
          <div className="key-list"><strong>Chaves cadastradas</strong>{keys.length ? keys.map((key) => <div className="key-row" key={key.id}><div><span>{key.label || 'Sem identificação'}</span><small>{keyStatusLabel(key.status)} · expira {key.expires_at ? new Date(key.expires_at).toLocaleString('pt-BR') : '—'} · último uso {key.last_used_at ? new Date(key.last_used_at).toLocaleString('pt-BR') : 'nunca'}</small></div><div className="key-actions">{key.status === 'active' && <button type="button" className="secondary" disabled={saving} onClick={() => void rotateKey(key.id)}>Rotacionar</button>}{(key.status === 'active' || key.status === 'retiring') && <button type="button" className="danger-link" disabled={saving} onClick={() => void revokeKey(key.id)}>Revogar</button>}</div></div>) : <small>Nenhuma chave cadastrada.</small>}</div>
        </div>
      </div>
      <div className="map-privacy-note"><strong>Fluxo de máquina:</strong> Gateway/Edge → HTTPS → Worker Hono → hash da chave → Neon → telemetria/status/evento. Na rotação, a chave anterior permanece válida apenas durante a janela escolhida e depois expira automaticamente.</div>
    </section>
  );
}

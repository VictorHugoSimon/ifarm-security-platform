import { FormEvent, useEffect, useMemo, useState } from 'react';
import { neon } from './lib/neon';
import './events.css';

type Severity = 'informational' | 'attention' | 'high' | 'critical';
type EventRow = {
  id: string;
  event_type: string;
  severity: Severity;
  confidence: number | string | null;
  human_validation_status: 'pending' | 'confirmed' | 'rejected' | 'not_required';
  acknowledged_at: string | null;
  occurred_at: string;
  received_at: string;
  device_id: string | null;
  device_name: string | null;
  scope: 'community' | 'private';
  organization_id: string;
  neighborhood_id: string | null;
  property_id: string | null;
  metadata: Record<string, unknown>;
};
type AlertRow = { id: string; event_id: string | null; severity: Severity; channel: string; status: string; created_at: string; event_type: string | null; occurred_at: string | null };
type AlertRule = { id: string; organization_id: string; neighborhood_id: string | null; property_id: string | null; name: string; event_type: string | null; min_severity: Severity; channel: string; enabled: boolean };
type Organization = { id: string; name: string };
type Neighborhood = { id: string; organization_id: string; name: string };
type Property = { id: string; organization_id: string; name: string };

const severityLabel: Record<Severity, string> = { informational: 'Informativo', attention: 'Atenção', high: 'Alto', critical: 'Crítico' };
const validationLabel: Record<EventRow['human_validation_status'], string> = { pending: 'Aguardando validação', confirmed: 'Confirmado', rejected: 'Rejeitado', not_required: 'Não requerida' };

export function EventCenter() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [severity, setSeverity] = useState<'all' | Severity>('all');
  const [validation, setValidation] = useState<'all' | EventRow['human_validation_status']>('all');
  const [scope, setScope] = useState<'all' | 'community' | 'private'>('all');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const [ruleName, setRuleName] = useState('Alertas operacionais');
  const [ruleOrg, setRuleOrg] = useState('');
  const [ruleScope, setRuleScope] = useState<'organization' | 'neighborhood' | 'property'>('property');
  const [ruleNeighborhood, setRuleNeighborhood] = useState('');
  const [ruleProperty, setRuleProperty] = useState('');
  const [ruleEventType, setRuleEventType] = useState('');
  const [ruleSeverity, setRuleSeverity] = useState<Severity>('attention');
  const [ruleChannel, setRuleChannel] = useState('app');

  const visibleEvents = useMemo(() => events.filter((event) => {
    if (severity !== 'all' && event.severity !== severity) return false;
    if (validation !== 'all' && event.human_validation_status !== validation) return false;
    if (scope !== 'all' && event.scope !== scope) return false;
    return true;
  }), [events, severity, validation, scope]);

  const orgNeighborhoods = useMemo(() => neighborhoods.filter((item) => item.organization_id === ruleOrg), [neighborhoods, ruleOrg]);
  const orgProperties = useMemo(() => properties.filter((item) => item.organization_id === ruleOrg), [properties, ruleOrg]);

  async function load() {
    const [eventResult, alertResult, ruleResult, orgResult, neighborhoodResult, propertyResult] = await Promise.all([
      neon.rpc('get_event_feed', { p_limit: 200 }),
      neon.rpc('get_alert_feed', { p_limit: 100 }),
      neon.from('alert_rules').select('id,organization_id,neighborhood_id,property_id,name,event_type,min_severity,channel,enabled').order('created_at', { ascending: false }),
      neon.from('organizations').select('id,name'),
      neon.from('neighborhoods').select('id,organization_id,name'),
      neon.from('properties').select('id,organization_id,name')
    ]);
    if (eventResult.error || alertResult.error || ruleResult.error || orgResult.error || neighborhoodResult.error || propertyResult.error) {
      setMessage('Não foi possível carregar a Central de Eventos.');
      return;
    }
    const orgRows = (orgResult.data || []) as Organization[];
    setEvents((eventResult.data || []) as EventRow[]);
    setAlerts((alertResult.data || []) as AlertRow[]);
    setRules((ruleResult.data || []) as AlertRule[]);
    setOrganizations(orgRows);
    setNeighborhoods((neighborhoodResult.data || []) as Neighborhood[]);
    setProperties((propertyResult.data || []) as Property[]);
    setRuleOrg((current) => current || orgRows[0]?.id || '');
  }

  async function acknowledge(eventId: string) {
    setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('ack_security_event', { p_event_id: eventId });
      if (result.error) return setMessage('Não foi possível reconhecer este evento.');
      setMessage('Evento reconhecido e registrado na auditoria.');
      await load();
    } finally { setSaving(false); }
  }

  async function validateEvent(eventId: string, decision: 'confirmed' | 'rejected') {
    setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('validate_security_event', { p_event_id: eventId, p_decision: decision, p_note: null });
      if (result.error) return setMessage(result.error.message.includes('not_pending') ? 'Este evento já foi validado.' : 'Não foi possível validar o evento.');
      setMessage(decision === 'confirmed' ? 'Evento confirmado por validação humana.' : 'Evento rejeitado por validação humana.');
      await load();
    } finally { setSaving(false); }
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('create_my_alert_rule', {
        p_organization_id: ruleOrg,
        p_name: ruleName,
        p_event_type: ruleEventType.trim() || null,
        p_min_severity: ruleSeverity,
        p_channel: ruleChannel,
        p_neighborhood_id: ruleScope === 'neighborhood' ? ruleNeighborhood : null,
        p_property_id: ruleScope === 'property' ? ruleProperty : null
      });
      if (result.error) return setMessage('Seu perfil não possui acesso ao escopo escolhido ou a regra é inválida.');
      setMessage(ruleChannel === 'app' ? 'Assinatura criada. Novos eventos compatíveis gerarão alerta no app.' : 'Assinatura criada, mas o canal externo ficará bloqueado até integração homologada.');
      await load();
    } finally { setSaving(false); }
  }

  async function deleteRule(ruleId: string) {
    setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('delete_my_alert_rule', { p_rule_id: ruleId });
      if (result.error) return setMessage('Não foi possível remover a assinatura.');
      setMessage('Assinatura removida.');
      await load();
    } finally { setSaving(false); }
  }

  useEffect(() => { void load(); }, []);

  const pending = events.filter((event) => event.human_validation_status === 'pending').length;
  const critical = events.filter((event) => event.severity === 'critical').length;
  const queued = alerts.filter((alert) => alert.status === 'queued').length;
  const blocked = alerts.filter((alert) => alert.status === 'blocked_external').length;

  return (
    <section id="event-center">
      <div className="section-heading"><div><span className="eyebrow">SEC-040 / SEC-043</span><h2>Central de Eventos e Alertas</h2></div><div className="structure-counts"><span>{events.length} eventos</span><span>{pending} pendentes</span><span>{critical} críticos</span><span>{queued} alertas app</span></div></div>
      {message && <div className="structure-message">{message}</div>}
      <div className="event-toolbar">
        <label>Severidade<select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}><option value="all">Todas</option>{Object.entries(severityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Validação<select value={validation} onChange={(e) => setValidation(e.target.value as typeof validation)}><option value="all">Todas</option><option value="pending">Pendente</option><option value="confirmed">Confirmado</option><option value="rejected">Rejeitado</option><option value="not_required">Não requerida</option></select></label>
        <label>Escopo<select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}><option value="all">Todos</option><option value="community">Community</option><option value="private">Private</option></select></label>
        <button className="secondary" type="button" onClick={() => void load()}>Atualizar</button>
      </div>

      <div className="event-layout">
        <div className="event-list">
          {visibleEvents.length ? visibleEvents.map((event) => <article className={`event-card severity-${event.severity}`} key={event.id}>
            <div className="event-card-head"><div><span className="event-type">{event.event_type}</span><strong>{event.device_name || 'Evento da plataforma'}</strong></div><span className={`severity-pill severity-pill-${event.severity}`}>{severityLabel[event.severity]}</span></div>
            <div className="event-meta"><span>{event.scope === 'private' ? 'Privado' : 'Comunitário'}</span><span>{new Date(event.occurred_at).toLocaleString('pt-BR')}</span>{event.confidence !== null && <span>Confiança {(Number(event.confidence) * 100).toFixed(0)}%</span>}</div>
            <div className="event-validation"><span>{validationLabel[event.human_validation_status]}</span>{event.acknowledged_at && <span>Reconhecido</span>}</div>
            <div className="event-actions">{!event.acknowledged_at && <button className="secondary" disabled={saving} onClick={() => void acknowledge(event.id)}>Reconhecer</button>}{event.human_validation_status === 'pending' && <><button className="primary" disabled={saving} onClick={() => void validateEvent(event.id, 'confirmed')}>Confirmar</button><button className="reject-button" disabled={saving} onClick={() => void validateEvent(event.id, 'rejected')}>Rejeitar</button></>}</div>
          </article>) : <div className="empty-state">Nenhum evento dentro dos filtros e permissões atuais.</div>}
        </div>

        <aside className="event-side-panel">
          <form className="structure-card" onSubmit={createRule}>
            <strong>Minha assinatura de alertas</strong><p>Define quais novos eventos devem gerar alertas para você. Canais externos permanecem bloqueados até provedor homologado.</p>
            <label>Nome<input required maxLength={120} value={ruleName} onChange={(e) => setRuleName(e.target.value)} /></label>
            <label>Organização<select required value={ruleOrg} onChange={(e) => { setRuleOrg(e.target.value); setRuleNeighborhood(''); setRuleProperty(''); }}><option value="">Selecione</option>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Escopo<select value={ruleScope} onChange={(e) => setRuleScope(e.target.value as typeof ruleScope)}><option value="property">Propriedade</option><option value="neighborhood">Bairro comunitário</option><option value="organization">Organização inteira (admin)</option></select></label>
            {ruleScope === 'property' && <label>Propriedade<select required value={ruleProperty} onChange={(e) => setRuleProperty(e.target.value)}><option value="">Selecione</option>{orgProperties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
            {ruleScope === 'neighborhood' && <label>Bairro<select required value={ruleNeighborhood} onChange={(e) => setRuleNeighborhood(e.target.value)}><option value="">Selecione</option>{orgNeighborhoods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
            <label>Tipo do evento<input placeholder="opcional: device.offline" maxLength={120} value={ruleEventType} onChange={(e) => setRuleEventType(e.target.value)} /></label>
            <div className="field-row rule-row"><label>Severidade mínima<select value={ruleSeverity} onChange={(e) => setRuleSeverity(e.target.value as Severity)}>{Object.entries(severityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Canal<select value={ruleChannel} onChange={(e) => setRuleChannel(e.target.value)}><option value="app">App</option><option value="push">Push</option><option value="email">E-mail</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select></label></div>
            <button className="primary" disabled={saving || !ruleOrg || (ruleScope === 'property' && !ruleProperty) || (ruleScope === 'neighborhood' && !ruleNeighborhood)}>Criar assinatura</button>
          </form>
          <div className="structure-card"><strong>Assinaturas ativas</strong>{rules.length ? rules.map((rule) => <div className="rule-item" key={rule.id}><div><span>{rule.name}</span><small>{rule.channel} · mínimo {severityLabel[rule.min_severity]}{rule.event_type ? ` · ${rule.event_type}` : ''}</small></div><button className="danger-link" disabled={saving} onClick={() => void deleteRule(rule.id)}>Remover</button></div>) : <small>Nenhuma assinatura criada.</small>}</div>
          <div className="alert-summary"><strong>Fila de alertas</strong><span>{queued} prontos no app</span><span>{blocked} externos bloqueados</span><small>Nenhum SMS, e-mail, push ou WhatsApp é enviado nesta fase.</small></div>
        </aside>
      </div>
    </section>
  );
}

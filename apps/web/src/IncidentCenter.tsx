import { FormEvent, useEffect, useMemo, useState } from 'react';
import { neon } from './lib/neon';
import './incidents.css';

type IncidentStatus = 'open' | 'investigating' | 'monitoring' | 'resolved' | 'closed';
type IncidentRow = {
  id: string;
  title: string;
  severity: 'informational' | 'attention' | 'high' | 'critical';
  status: IncidentStatus;
  opened_at: string;
  updated_at: string;
  closed_at: string | null;
  responsible_user_id: string | null;
  responsible_name: string | null;
  scope: 'community' | 'private';
  organization_id: string;
  neighborhood_id: string | null;
  property_id: string | null;
  event_count: number | string;
  summary: string | null;
};
type EventRow = {
  id: string;
  event_type: string;
  severity: string;
  human_validation_status: 'pending' | 'confirmed' | 'rejected' | 'not_required';
  occurred_at: string;
  device_name: string | null;
  scope: 'community' | 'private';
};
type TimelineRow = { id: number; action: string; note: string | null; details: Record<string, unknown>; actor_name: string; created_at: string };
type IncidentEvent = { event_id: string; event_type: string; severity: string; human_validation_status: string; occurred_at: string; device_name: string | null };

const statusLabel: Record<IncidentStatus, string> = { open: 'Aberto', investigating: 'Investigando', monitoring: 'Monitorando', resolved: 'Resolvido', closed: 'Encerrado' };
const actionLabel: Record<string, string> = { created: 'Incidente criado', event_added: 'Evento vinculado', status_changed: 'Status alterado', claimed: 'Responsabilidade assumida', note_added: 'Nota adicionada' };

export function IncidentCenter() {
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [incidentEvents, setIncidentEvents] = useState<IncidentEvent[]>([]);
  const [selectedIncident, setSelectedIncident] = useState('');
  const [sourceEvent, setSourceEvent] = useState('');
  const [additionalEvent, setAdditionalEvent] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [note, setNote] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | IncidentStatus>('all');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const eligibleEvents = useMemo(() => events.filter((event) => ['confirmed', 'not_required'].includes(event.human_validation_status)), [events]);
  const visibleIncidents = useMemo(() => incidents.filter((incident) => statusFilter === 'all' || incident.status === statusFilter), [incidents, statusFilter]);
  const selected = incidents.find((incident) => incident.id === selectedIncident) || null;

  async function load() {
    const [incidentResult, eventResult] = await Promise.all([
      neon.rpc('get_incident_feed', { p_limit: 200 }),
      neon.rpc('get_event_feed', { p_limit: 300 })
    ]);
    if (incidentResult.error || eventResult.error) {
      setMessage('Não foi possível carregar o Incident Center.');
      return;
    }
    const incidentRows = (incidentResult.data || []) as IncidentRow[];
    const eventRows = (eventResult.data || []) as EventRow[];
    setIncidents(incidentRows);
    setEvents(eventRows);
    setSelectedIncident((current) => current || incidentRows[0]?.id || '');
    setSourceEvent((current) => current || eventRows.find((event) => ['confirmed', 'not_required'].includes(event.human_validation_status))?.id || '');
  }

  async function loadDetails(incidentId: string) {
    if (!incidentId) { setTimeline([]); setIncidentEvents([]); return; }
    const [timelineResult, eventResult] = await Promise.all([
      neon.rpc('get_incident_timeline', { p_incident_id: incidentId }),
      neon.rpc('get_incident_events', { p_incident_id: incidentId })
    ]);
    if (timelineResult.error || eventResult.error) return setMessage('Não foi possível carregar a timeline do incidente.');
    setTimeline((timelineResult.data || []) as TimelineRow[]);
    setIncidentEvents((eventResult.data || []) as IncidentEvent[]);
  }

  async function createIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('create_incident_from_event', { p_event_id: sourceEvent, p_title: title.trim() || null, p_summary: summary.trim() || null });
      if (result.error) {
        if (result.error.message.includes('validation_required')) setMessage('O evento precisa ser validado por uma pessoa antes de virar incidente.');
        else if (result.error.message.includes('event_rejected')) setMessage('Evento rejeitado não pode virar incidente.');
        else setMessage('Não foi possível criar o incidente.');
        return;
      }
      const incidentId = result.data as string;
      setTitle(''); setSummary(''); setSelectedIncident(incidentId); setMessage('Incidente criado e evento de origem vinculado.');
      await load(); await loadDetails(incidentId);
    } finally { setSaving(false); }
  }

  async function updateStatus(status: IncidentStatus) {
    if (!selectedIncident) return;
    setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('update_incident_status', { p_incident_id: selectedIncident, p_status: status, p_note: null });
      if (result.error) return setMessage(result.error.message.includes('closed_incident') ? 'Incidente encerrado não pode ser reaberto nesta fase.' : 'Não foi possível alterar o status.');
      setMessage(`Status atualizado para ${statusLabel[status]}.`); await load(); await loadDetails(selectedIncident);
    } finally { setSaving(false); }
  }

  async function claimIncident() {
    if (!selectedIncident) return;
    setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('claim_incident', { p_incident_id: selectedIncident });
      if (result.error) return setMessage('Não foi possível assumir o incidente.');
      setMessage('Você agora é o responsável pelo incidente.'); await load(); await loadDetails(selectedIncident);
    } finally { setSaving(false); }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedIncident || !note.trim()) return;
    setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('add_incident_note', { p_incident_id: selectedIncident, p_note: note.trim() });
      if (result.error) return setMessage('Não foi possível adicionar a nota.');
      setNote(''); setMessage('Nota adicionada à timeline.'); await loadDetails(selectedIncident);
    } finally { setSaving(false); }
  }

  async function addEvent() {
    if (!selectedIncident || !additionalEvent) return;
    setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('add_event_to_incident', { p_incident_id: selectedIncident, p_event_id: additionalEvent });
      if (result.error) {
        if (result.error.message.includes('scope_mismatch')) setMessage('O evento pertence a outro escopo e não pode ser misturado neste incidente.');
        else if (result.error.message.includes('validation_required')) setMessage('Valide o evento antes de vinculá-lo.');
        else setMessage('Não foi possível vincular o evento.');
        return;
      }
      setAdditionalEvent(''); setMessage('Evento vinculado ao incidente.'); await load(); await loadDetails(selectedIncident);
    } finally { setSaving(false); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => { void loadDetails(selectedIncident); }, [selectedIncident]);

  const openCount = incidents.filter((incident) => !['resolved', 'closed'].includes(incident.status)).length;
  const criticalCount = incidents.filter((incident) => incident.severity === 'critical' && incident.status !== 'closed').length;

  return (
    <section id="incident-center">
      <div className="section-heading"><div><span className="eyebrow">SEC-050</span><h2>Incident Center</h2></div><div className="structure-counts"><span>{incidents.length} incidentes</span><span>{openCount} ativos</span><span>{criticalCount} críticos</span></div></div>
      {message && <div className="structure-message">{message}</div>}
      <div className="incident-create-layout">
        <form className="structure-card" onSubmit={createIncident}>
          <strong>Criar incidente a partir de evento</strong><p>Somente eventos confirmados por humano ou técnicos sem necessidade de validação podem ser promovidos.</p>
          <label>Evento elegível<select required value={sourceEvent} onChange={(e) => setSourceEvent(e.target.value)}><option value="">Selecione</option>{eligibleEvents.map((event) => <option key={event.id} value={event.id}>{event.event_type} · {event.device_name || 'plataforma'} · {event.scope}</option>)}</select></label>
          <label>Título<input maxLength={160} placeholder="Opcional: gerado pelo evento" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>Resumo<textarea maxLength={4000} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
          <button className="primary" disabled={saving || !sourceEvent}>Criar incidente</button>
        </form>
        <div className="incident-principles"><strong>Regra operacional</strong><p>Incidente organiza resposta, evidências e responsabilidades. Ele não presume ocorrência criminal nem substitui validação humana ou autoridade competente.</p><span>Community e Private não são misturados.</span><span>Evento rejeitado nunca vira incidente.</span><span>Encerramento fica na auditoria.</span></div>
      </div>

      <div className="incident-toolbar"><label>Status<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">Todos</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="secondary" onClick={() => void load()}>Atualizar</button></div>
      <div className="incident-workspace">
        <div className="incident-list">{visibleIncidents.length ? visibleIncidents.map((incident) => <button key={incident.id} className={`incident-item ${incident.id === selectedIncident ? 'selected' : ''}`} onClick={() => setSelectedIncident(incident.id)}><div><strong>{incident.title}</strong><small>{incident.scope} · {incident.event_count} evento(s)</small></div><div className="incident-item-status"><span className={`incident-status incident-status-${incident.status}`}>{statusLabel[incident.status]}</span><small>{new Date(incident.opened_at).toLocaleString('pt-BR')}</small></div></button>) : <div className="empty-state">Nenhum incidente visível.</div>}</div>
        <div className="incident-detail">{selected ? <>
          <div className="incident-detail-head"><div><span className="eyebrow">INCIDENTE</span><h3>{selected.title}</h3><p>{selected.summary || 'Sem resumo registrado.'}</p></div><span className={`incident-status incident-status-${selected.status}`}>{statusLabel[selected.status]}</span></div>
          <div className="incident-facts"><span>Escopo: <strong>{selected.scope}</strong></span><span>Severidade: <strong>{selected.severity}</strong></span><span>Responsável: <strong>{selected.responsible_name || 'não atribuído'}</strong></span><span>Eventos: <strong>{selected.event_count}</strong></span></div>
          {selected.status !== 'closed' && <div className="incident-actions"><button className="secondary" disabled={saving} onClick={() => void claimIncident()}>Assumir</button><button className="secondary" disabled={saving} onClick={() => void updateStatus('investigating')}>Investigar</button><button className="secondary" disabled={saving} onClick={() => void updateStatus('monitoring')}>Monitorar</button><button className="primary" disabled={saving} onClick={() => void updateStatus('resolved')}>Resolver</button><button className="close-button" disabled={saving} onClick={() => void updateStatus('closed')}>Encerrar</button></div>}
          {selected.status !== 'closed' && <form className="incident-note-form" onSubmit={addNote}><textarea maxLength={2000} rows={2} placeholder="Adicionar nota operacional à timeline" value={note} onChange={(e) => setNote(e.target.value)} /><button className="secondary" disabled={saving || !note.trim()}>Adicionar nota</button></form>}
          {selected.status !== 'closed' && <div className="incident-add-event"><select value={additionalEvent} onChange={(e) => setAdditionalEvent(e.target.value)}><option value="">Adicionar evento elegível...</option>{eligibleEvents.map((event) => <option key={event.id} value={event.id}>{event.event_type} · {event.device_name || 'plataforma'}</option>)}</select><button className="secondary" disabled={saving || !additionalEvent} onClick={() => void addEvent()}>Vincular</button></div>}
          <div className="incident-events"><strong>Eventos vinculados</strong>{incidentEvents.length ? incidentEvents.map((event) => <div key={event.event_id}><span>{event.event_type}</span><small>{event.device_name || 'plataforma'} · {new Date(event.occurred_at).toLocaleString('pt-BR')}</small></div>) : <small>Nenhum evento vinculado.</small>}</div>
          <div className="incident-timeline"><strong>Timeline</strong>{timeline.length ? timeline.map((item) => <div className="timeline-item" key={item.id}><span></span><div><strong>{actionLabel[item.action] || item.action}</strong>{item.note && <p>{item.note}</p>}<small>{item.actor_name} · {new Date(item.created_at).toLocaleString('pt-BR')}</small></div></div>) : <small>Sem ações registradas.</small>}</div>
        </> : <div className="empty-state">Selecione um incidente.</div>}</div>
      </div>
    </section>
  );
}

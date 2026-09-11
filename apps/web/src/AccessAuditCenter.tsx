import { useEffect, useMemo, useState } from 'react';
import { neon } from './lib/neon';

type AccessAuditEvent = {
  id: number;
  organization_id: string;
  organization_name?: string | null;
  neighborhood_id?: string | null;
  neighborhood_name?: string | null;
  property_id?: string | null;
  property_name?: string | null;
  actor_name?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  target_role?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  reason?: string | null;
  occurred_at: string;
};

const actionLabels: Record<string, string> = {
  'access.invitation.created': 'Convite criado',
  'access.invitation.accepted': 'Convite aceito',
  'access.invitation.revoked': 'Convite revogado',
  'access.membership.suspended': 'Acesso suspenso',
  'access.membership.reactivated': 'Acesso reativado',
  'access.membership.revoked': 'Acesso revogado'
};

const roleLabels: Record<string, string> = {
  admin_organization: 'Admin organização',
  admin_neighborhood: 'Admin bairro',
  owner: 'Proprietário',
  family: 'Família',
  employee: 'Funcionário',
  technician: 'Técnico',
  monitoring: 'Monitoramento'
};

function scopeLabel(event: AccessAuditEvent) {
  if (event.property_name) return `Propriedade · ${event.property_name}`;
  if (event.neighborhood_name) return `Bairro · ${event.neighborhood_name}`;
  return `Organização · ${event.organization_name || 'escopo autorizado'}`;
}

function transitionLabel(event: AccessAuditEvent) {
  if (!event.from_status && !event.to_status) return null;
  return `${event.from_status || '—'} → ${event.to_status || '—'}`;
}

export function AccessAuditCenter() {
  const [events, setEvents] = useState<AccessAuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const result = await neon.rpc('list_access_audit_events', {
        p_organization_id: null,
        p_limit: 100
      });

      if (result.error) {
        setEvents([]);
        setMessage('A trilha de auditoria não está disponível para este perfil ou sessão.');
        return;
      }

      setEvents((result.data || []) as AccessAuditEvent[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const counters = useMemo(() => ({
    invitations: events.filter((event) => event.action.startsWith('access.invitation.')).length,
    memberships: events.filter((event) => event.action.startsWith('access.membership.')).length,
    criticalChanges: events.filter((event) => event.action === 'access.membership.suspended' || event.action === 'access.membership.revoked').length
  }), [events]);

  return (
    <section id="access-audit">
      <div className="section-heading">
        <div><span className="eyebrow">SEC-177</span><h2>Auditoria de acessos</h2></div>
        <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button>
      </div>

      <div className="audit-metrics">
        <article><span>Eventos visíveis</span><strong>{events.length}</strong></article>
        <article><span>Convites</span><strong>{counters.invitations}</strong></article>
        <article><span>Mudanças de acesso</span><strong>{counters.memberships}</strong></article>
        <article><span>Suspensão / revogação</span><strong>{counters.criticalChanges}</strong></article>
      </div>

      <div className="audit-list">
        {!events.length && !message && <div className="audit-empty">Nenhum evento de acesso visível para esta sessão.</div>}
        {events.map((event) => {
          const transition = transitionLabel(event);
          return (
            <article className="audit-row" key={event.id}>
              <div className="audit-marker" aria-hidden="true" />
              <div className="audit-main">
                <div className="audit-title-line">
                  <strong>{actionLabels[event.action] || event.action}</strong>
                  <time>{new Date(event.occurred_at).toLocaleString('pt-BR')}</time>
                </div>
                <span>{scopeLabel(event)}</span>
                <small>
                  Ator: {event.actor_name || 'sistema/usuário autenticado'}
                  {event.target_role ? ` · Papel: ${roleLabels[event.target_role] || event.target_role}` : ''}
                  {transition ? ` · ${transition}` : ''}
                </small>
                {event.reason && <p>Motivo: {event.reason}</p>}
              </div>
            </article>
          );
        })}
      </div>

      {message && <div className="structure-message">{message}</div>}
      <div className="map-privacy-note"><strong>Audit by Design:</strong> esta tela recebe apenas uma visão sanitizada. O browser não acessa `audit_logs`, IP, request metadata, e-mail/hash de convite nem o campo `details` bruto.</div>
    </section>
  );
}

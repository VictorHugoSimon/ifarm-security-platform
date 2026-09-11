import { FormEvent, useEffect, useMemo, useState } from 'react';
import { neon } from './lib/neon';

type MembershipStatus = 'active' | 'suspended' | 'revoked';
type MembershipRole = 'admin_organization' | 'admin_neighborhood' | 'owner' | 'family' | 'employee' | 'technician' | 'monitoring';
type Organization = { id: string; name: string };
type Membership = {
  id: string;
  organization_id: string;
  organization_name: string;
  neighborhood_id?: string | null;
  neighborhood_name?: string | null;
  property_id?: string | null;
  property_name?: string | null;
  user_id: string;
  full_name: string;
  email: string;
  role: MembershipRole;
  status: MembershipStatus;
  created_at: string;
  status_changed_at: string;
  status_reason?: string | null;
};

type PendingAction = { membership: Membership; status: MembershipStatus } | null;

const roleLabels: Record<MembershipRole, string> = {
  admin_organization: 'Admin organização',
  admin_neighborhood: 'Admin bairro',
  owner: 'Proprietário',
  family: 'Família',
  employee: 'Funcionário',
  technician: 'Técnico',
  monitoring: 'Monitoramento'
};

function scopeLabel(item: Membership) {
  if (item.property_name) return `Propriedade · ${item.property_name}`;
  if (item.neighborhood_name) return `Bairro · ${item.neighborhood_name}`;
  return 'Organização';
}

function errorMessage(message = '') {
  if (message.includes('membership_management_not_allowed')) return 'Seu perfil não pode administrar este acesso.';
  if (message.includes('membership_role_requires_separate_onboarding')) return 'Este papel exige processo administrativo separado.';
  if (message.includes('membership_revoked_terminal')) return 'Acesso revogado é terminal e não pode ser reativado.';
  if (message.includes('membership_reason_required')) return 'Informe um motivo com pelo menos 3 caracteres.';
  if (message.includes('membership_status_unchanged')) return 'O acesso já está neste status.';
  return 'Não foi possível alterar o acesso.';
}

export function MembershipManagement() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MembershipStatus>('all');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    const [orgResult, membershipResult] = await Promise.all([
      neon.from('organizations').select('id,name').order('name'),
      neon.rpc('list_managed_memberships', { p_organization_id: null })
    ]);

    if (orgResult.error || membershipResult.error) {
      setMessage('Não foi possível carregar os acessos ativos gerenciáveis.');
      return;
    }

    setOrganizations((orgResult.data || []) as Organization[]);
    setMemberships((membershipResult.data || []) as Membership[]);
  }

  useEffect(() => { void load(); }, []);

  const visible = useMemo(
    () => memberships.filter((item) =>
      (!organizationId || item.organization_id === organizationId) &&
      (statusFilter === 'all' || item.status === statusFilter)
    ),
    [memberships, organizationId, statusFilter]
  );

  const active = memberships.filter((item) => item.status === 'active').length;
  const suspended = memberships.filter((item) => item.status === 'suspended').length;
  const revoked = memberships.filter((item) => item.status === 'revoked').length;

  function requestAction(membership: Membership, status: MembershipStatus) {
    setPendingAction({ membership, status });
    setReason('');
    setMessage('');
  }

  async function applyStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingAction) return;

    setLoading(true);
    setMessage('');
    try {
      const result = await neon.rpc('set_membership_status', {
        p_membership_id: pendingAction.membership.id,
        p_status: pendingAction.status,
        p_reason: reason.trim() || null
      });

      if (result.error) {
        setMessage(errorMessage(result.error.message));
        return;
      }

      const label = pendingAction.status === 'active' ? 'reativado' : pendingAction.status === 'suspended' ? 'suspenso' : 'revogado';
      setMessage(`Acesso ${label} e auditado.`);
      setPendingAction(null);
      setReason('');
      await load();
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="membership-management">
      <div className="section-heading">
        <div><span className="eyebrow">SEC-176</span><h2>Acessos ativos</h2></div>
        <div className="structure-counts"><span>{active} ativos</span><span>{suspended} suspensos</span><span>{revoked} revogados</span></div>
      </div>

      <div className="membership-toolbar">
        <label>Organização
          <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
            <option value="">Todas autorizadas</option>
            {organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | MembershipStatus)}>
            <option value="all">Todos</option><option value="active">Ativo</option><option value="suspended">Suspenso</option><option value="revoked">Revogado</option>
          </select>
        </label>
        <button className="secondary" type="button" onClick={() => void load()} disabled={loading}>Atualizar</button>
      </div>

      {pendingAction && (
        <form className="membership-action-card" onSubmit={applyStatus}>
          <div>
            <strong>{pendingAction.status === 'active' ? 'Reativar acesso' : pendingAction.status === 'suspended' ? 'Suspender acesso' : 'Revogar acesso'}</strong>
            <p>{pendingAction.membership.full_name} · {roleLabels[pendingAction.membership.role]} · {scopeLabel(pendingAction.membership)}</p>
          </div>
          <label>Motivo {pendingAction.status !== 'active' && <span>*</span>}
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required={pendingAction.status !== 'active'}
              minLength={pendingAction.status !== 'active' ? 3 : undefined}
              maxLength={500}
              placeholder={pendingAction.status === 'active' ? 'Opcional' : 'Motivo operacional/auditável'}
            />
          </label>
          <div className="membership-action-buttons">
            <button className="secondary" type="button" onClick={() => setPendingAction(null)} disabled={loading}>Cancelar</button>
            <button className="primary" disabled={loading}>{loading ? 'Processando…' : 'Confirmar'}</button>
          </div>
        </form>
      )}

      <div className="membership-list">
        {!visible.length && <div className="access-empty">Nenhum acesso gerenciável para os filtros selecionados.</div>}
        {visible.map((item) => (
          <article className="membership-row" key={item.id}>
            <div className="membership-identity">
              <strong>{item.full_name}</strong>
              <span>{item.email}</span>
              <small>{item.organization_name} · {scopeLabel(item)}</small>
            </div>
            <div className="membership-role"><span>{roleLabels[item.role]}</span><small>desde {new Date(item.created_at).toLocaleDateString('pt-BR')}</small></div>
            <div className="membership-state">
              <span className={`access-status ${item.status}`}>{item.status}</span>
              {item.status_reason && <small title={item.status_reason}>{item.status_reason}</small>}
            </div>
            <div className="membership-actions">
              {item.status === 'active' && <button className="secondary" type="button" onClick={() => requestAction(item, 'suspended')}>Suspender</button>}
              {item.status === 'suspended' && <button className="secondary" type="button" onClick={() => requestAction(item, 'active')}>Reativar</button>}
              {item.status !== 'revoked' && <button className="secondary danger" type="button" onClick={() => requestAction(item, 'revoked')}>Revogar</button>}
            </div>
          </article>
        ))}
      </div>

      {message && <div className="structure-message">{message}</div>}
      <div className="map-privacy-note"><strong>Revogação por escopo:</strong> revogar um membership remove aquele acesso imediatamente porque as políticas consideram apenas memberships `active`. Revogado é terminal; perfis institucionais, seguro e Admin iFarm continuam fora desta superfície.</div>
    </section>
  );
}

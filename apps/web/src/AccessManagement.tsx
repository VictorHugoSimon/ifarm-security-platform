import { FormEvent, useEffect, useMemo, useState } from 'react';
import { neon } from './lib/neon';

type Organization = { id: string; name: string };
type Neighborhood = { id: string; organization_id: string; name: string };
type Property = { id: string; organization_id: string; neighborhood_id?: string | null; name: string };
type InvitationRole = 'admin_organization' | 'admin_neighborhood' | 'owner' | 'family' | 'employee' | 'technician' | 'monitoring';
type ScopeMode = 'organization' | 'neighborhood' | 'property';

type Invitation = {
  id: string;
  organization_id: string;
  organization_name: string;
  neighborhood_id?: string | null;
  neighborhood_name?: string | null;
  property_id?: string | null;
  property_name?: string | null;
  email: string;
  role: InvitationRole;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expires_at: string;
  accepted_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
};

const roleLabels: Record<InvitationRole, string> = {
  admin_organization: 'Admin organização',
  admin_neighborhood: 'Admin bairro',
  owner: 'Proprietário',
  family: 'Família',
  employee: 'Funcionário',
  technician: 'Técnico',
  monitoring: 'Monitoramento'
};

const roleScope: Record<InvitationRole, ScopeMode | 'flexible'> = {
  admin_organization: 'organization',
  admin_neighborhood: 'neighborhood',
  owner: 'property',
  family: 'property',
  employee: 'property',
  technician: 'flexible',
  monitoring: 'flexible'
};

function messageForError(message = '') {
  if (message.includes('invitation_delegation_not_allowed')) return 'Seu perfil não pode delegar este papel neste escopo.';
  if (message.includes('invitation_role_requires_separate_onboarding')) return 'Este papel exige onboarding separado e não pode ser concedido por convite genérico.';
  if (message.includes('invitation_already_pending')) return 'Já existe um convite pendente para este e-mail, papel e escopo.';
  if (message.includes('membership_already_active')) return 'Este usuário já possui esse acesso ativo.';
  if (message.includes('invalid_invitation_expiration')) return 'A validade deve ficar entre 15 minutos e 30 dias.';
  if (message.includes('invalid_invitation_email')) return 'Informe um e-mail válido.';
  if (message.includes('scope_mismatch')) return 'O bairro ou a propriedade não pertence à organização selecionada.';
  if (message.includes('role_requires')) return 'Selecione o escopo exigido para este papel.';
  return 'Não foi possível concluir a operação de acesso.';
}

function scopeLabel(invitation: Invitation) {
  if (invitation.property_name) return `Propriedade · ${invitation.property_name}`;
  if (invitation.neighborhood_name) return `Bairro · ${invitation.neighborhood_name}`;
  return 'Organização';
}

export function AccessManagement() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitationRole>('family');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('property');
  const [neighborhoodId, setNeighborhoodId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [expirationDays, setExpirationDays] = useState('7');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const visibleNeighborhoods = useMemo(
    () => neighborhoods.filter((item) => item.organization_id === organizationId),
    [neighborhoods, organizationId]
  );
  const visibleProperties = useMemo(
    () => properties.filter((item) => item.organization_id === organizationId),
    [properties, organizationId]
  );

  async function load() {
    const [orgResult, neighborhoodResult, propertyResult, invitationResult] = await Promise.all([
      neon.from('organizations').select('id,name').order('name'),
      neon.from('neighborhoods').select('id,organization_id,name').order('name'),
      neon.from('properties').select('id,organization_id,neighborhood_id,name').order('name'),
      neon.rpc('list_access_invitations', { p_organization_id: null })
    ]);

    if (orgResult.error || neighborhoodResult.error || propertyResult.error || invitationResult.error) {
      setMessage('Não foi possível carregar a gestão de acessos autorizada para esta sessão.');
      return;
    }

    const orgRows = (orgResult.data || []) as Organization[];
    setOrganizations(orgRows);
    setNeighborhoods((neighborhoodResult.data || []) as Neighborhood[]);
    setProperties((propertyResult.data || []) as Property[]);
    setInvitations((invitationResult.data || []) as Invitation[]);
    setOrganizationId((current) => current || orgRows[0]?.id || '');
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const required = roleScope[role];
    if (required !== 'flexible') setScopeMode(required);
  }, [role]);

  useEffect(() => {
    if (!visibleNeighborhoods.some((item) => item.id === neighborhoodId)) setNeighborhoodId('');
    if (!visibleProperties.some((item) => item.id === propertyId)) setPropertyId('');
  }, [organizationId, neighborhoodId, propertyId, visibleNeighborhoods, visibleProperties]);

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const days = Number(expirationDays);
      if (!Number.isFinite(days) || days <= 0 || days > 30) {
        setMessage('A validade deve ficar entre 1 e 30 dias.');
        return;
      }

      const result = await neon.rpc('create_access_invitation', {
        p_organization_id: organizationId,
        p_email: email.trim(),
        p_role: role,
        p_neighborhood_id: scopeMode === 'neighborhood' ? neighborhoodId || null : null,
        p_property_id: scopeMode === 'property' ? propertyId || null : null,
        p_expires_at: new Date(Date.now() + days * 86_400_000).toISOString()
      });

      if (result.error) {
        setMessage(messageForError(result.error.message));
        return;
      }

      setEmail('');
      setMessage('Convite criado com escopo, validade e auditoria registrados.');
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function revokeInvitation(id: string) {
    setLoading(true);
    setMessage('');
    try {
      const result = await neon.rpc('revoke_access_invitation', { p_invitation_id: id });
      if (result.error) {
        setMessage(messageForError(result.error.message));
        return;
      }
      setMessage('Convite revogado e auditado.');
      await load();
    } finally {
      setLoading(false);
    }
  }

  const pending = invitations.filter((item) => item.status === 'pending').length;
  const accepted = invitations.filter((item) => item.status === 'accepted').length;

  return (
    <section id="access-management">
      <div className="section-heading">
        <div><span className="eyebrow">SEC-175</span><h2>Gestão de acessos</h2></div>
        <div className="structure-counts"><span>{invitations.length} convites</span><span>{pending} pendentes</span><span>{accepted} aceitos</span></div>
      </div>

      <div className="access-layout">
        <form className="structure-card" onSubmit={createInvitation}>
          <strong>Novo convite</strong>
          <p>O servidor valida quem pode delegar cada papel. Perfis de autoridade, seguro e Admin iFarm não usam este fluxo.</p>

          <label>Organização
            <select required value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
              <option value="">Selecione</option>
              {organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>

          <label>E-mail
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" placeholder="usuario@empresa.com.br" />
          </label>

          <label>Papel
            <select value={role} onChange={(event) => setRole(event.target.value as InvitationRole)}>
              {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>

          {roleScope[role] === 'flexible' && (
            <label>Tipo de escopo
              <select value={scopeMode} onChange={(event) => setScopeMode(event.target.value as ScopeMode)}>
                <option value="neighborhood">Bairro comunitário</option>
                <option value="property">Propriedade privada</option>
              </select>
            </label>
          )}

          {scopeMode === 'neighborhood' && (
            <label>Bairro
              <select required value={neighborhoodId} onChange={(event) => setNeighborhoodId(event.target.value)}>
                <option value="">Selecione</option>
                {visibleNeighborhoods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}

          {scopeMode === 'property' && (
            <label>Propriedade
              <select required value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
                <option value="">Selecione</option>
                {visibleProperties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}

          <label>Validade
            <select value={expirationDays} onChange={(event) => setExpirationDays(event.target.value)}>
              <option value="1">1 dia</option><option value="3">3 dias</option><option value="7">7 dias</option><option value="14">14 dias</option><option value="30">30 dias</option>
            </select>
          </label>

          <button className="primary" disabled={loading || !organizationId}>{loading ? 'Processando…' : 'Criar convite'}</button>
          <small className="map-note">O convite não cria acesso sozinho: a conta precisa estar autenticada, com e-mail verificado, e reivindicar um convite válido.</small>
        </form>

        <div className="access-list">
          <div className="access-list-heading"><strong>Convites gerenciáveis</strong><button type="button" className="secondary" onClick={() => void load()} disabled={loading}>Atualizar</button></div>
          {!invitations.length && <div className="access-empty">Nenhum convite gerenciável para esta sessão.</div>}
          {invitations.map((invitation) => (
            <article className="access-row" key={invitation.id}>
              <div className="access-row-main">
                <strong>{invitation.email}</strong>
                <span>{roleLabels[invitation.role]} · {scopeLabel(invitation)}</span>
                <small>{invitation.organization_name} · expira {new Date(invitation.expires_at).toLocaleString('pt-BR')}</small>
              </div>
              <div className="access-row-actions">
                <span className={`access-status ${invitation.status}`}>{invitation.status}</span>
                {invitation.status === 'pending' && <button type="button" className="secondary" onClick={() => void revokeInvitation(invitation.id)} disabled={loading}>Revogar</button>}
              </div>
            </article>
          ))}
        </div>
      </div>

      {message && <div className="structure-message">{message}</div>}
      <div className="map-privacy-note"><strong>Separação de privilégios:</strong> Admin Bairro não convida para propriedades privadas; Proprietário não cria administradores; Admin iFarm, Autoridade Autorizada e Parceiro de Seguro seguem onboarding separado.</div>
    </section>
  );
}

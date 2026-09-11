import { FormEvent, useEffect, useMemo, useState } from 'react';
import { neon } from './lib/neon';

type Organization = { id: string; name: string };
type Property = { id: string; organization_id: string; name: string };
type PrivacyRequest = {
  id: string;
  organization_id: string;
  organization_name: string;
  property_id: string | null;
  property_name: string | null;
  requester_name?: string;
  request_type: string;
  status: string;
  request_text: string;
  response_summary: string | null;
  internal_reference?: string | null;
  automated_execution_enabled: boolean;
  deletion_execution_supported?: boolean;
  legal_hold_review_required?: boolean;
  created_at: string;
};
type RetentionPolicy = {
  id: string;
  organization_id: string;
  data_class: string;
  retention_days: number;
  label: string;
  rationale: string | null;
  legal_review_reference: string | null;
  policy_status: string;
  automated_deletion_enabled: boolean;
  legal_review_required: boolean;
  approved_at: string | null;
};

const requestLabels: Record<string,string> = {
  access: 'Acesso aos dados', correction: 'Correção', export: 'Exportação', restriction: 'Restrição',
  deletion: 'Exclusão', objection: 'Oposição'
};
const statusLabels: Record<string,string> = {
  received: 'Recebida', under_review: 'Em análise', approved: 'Aprovada', partially_approved: 'Parcialmente aprovada',
  rejected: 'Rejeitada', fulfilled: 'Concluída', cancelled: 'Cancelada'
};
const dataClassLabels: Record<string,string> = {
  identity_access: 'Identidade e acessos', security_events: 'Eventos de segurança', incidents: 'Incidentes', evidence: 'Evidências',
  recordings: 'Gravações', telemetry: 'Telemetria', audit: 'Auditoria', support: 'Suporte', assets: 'Ativos', insurance: 'Insurance',
  consents: 'Consentimentos', community: 'Community'
};

export function PrivacyRetentionCenter() {
  const [organizations,setOrganizations] = useState<Organization[]>([]);
  const [properties,setProperties] = useState<Property[]>([]);
  const [organizationId,setOrganizationId] = useState('');
  const [propertyId,setPropertyId] = useState('');
  const [requestType,setRequestType] = useState('access');
  const [requestText,setRequestText] = useState('');
  const [myRequests,setMyRequests] = useState<PrivacyRequest[]>([]);
  const [managed,setManaged] = useState<PrivacyRequest[]>([]);
  const [policies,setPolicies] = useState<RetentionPolicy[]>([]);
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);

  const [dataClass,setDataClass] = useState('security_events');
  const [retentionDays,setRetentionDays] = useState('90');
  const [policyLabel,setPolicyLabel] = useState('Política operacional de retenção');
  const [policyStatus,setPolicyStatus] = useState('draft');
  const [rationale,setRationale] = useState('');
  const [legalReviewReference,setLegalReviewReference] = useState('');

  const scopedProperties = useMemo(() => properties.filter((p) => p.organization_id === organizationId), [properties,organizationId]);

  async function loadBase() {
    const [orgs,props] = await Promise.all([
      neon.from('organizations').select('id,name'),
      neon.from('properties').select('id,organization_id,name')
    ]);
    const orgRows = (orgs.data || []) as Organization[];
    setOrganizations(orgRows);
    setProperties((props.data || []) as Property[]);
    setOrganizationId((current) => current || orgRows[0]?.id || '');
  }

  async function loadPrivacy(orgId = organizationId) {
    if (!orgId) return;
    const [mine,queue,retention] = await Promise.all([
      neon.rpc('list_my_privacy_requests',{ p_organization_id: orgId }),
      neon.rpc('list_managed_privacy_requests',{ p_organization_id: orgId, p_status: null, p_limit: 200 }),
      neon.rpc('list_data_retention_policies',{ p_organization_id: orgId })
    ]);
    setMyRequests((mine.data || []) as PrivacyRequest[]);
    setManaged((queue.data || []) as PrivacyRequest[]);
    setPolicies((retention.data || []) as RetentionPolicy[]);
  }

  useEffect(() => { void loadBase(); }, []);
  useEffect(() => { if (organizationId) { setPropertyId(''); void loadPrivacy(organizationId); } }, [organizationId]);

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || requestText.trim().length < 3) return;
    setBusy(true); setMessage('');
    const result = await neon.rpc('create_my_privacy_request',{
      p_organization_id: organizationId,
      p_property_id: propertyId || null,
      p_request_type: requestType,
      p_request_text: requestText.trim()
    });
    if (result.error) setMessage('Não foi possível registrar a solicitação neste escopo.');
    else { setRequestText(''); setMessage('Solicitação registrada para análise humana. Nenhuma exclusão ou alteração de dados foi executada automaticamente.'); await loadPrivacy(); }
    setBusy(false);
  }

  async function cancelRequest(id: string) {
    setBusy(true); setMessage('');
    const result = await neon.rpc('cancel_my_privacy_request',{ p_request_id: id });
    if (result.error) setMessage('Esta solicitação não pode ser cancelada neste estado.');
    else { setMessage('Solicitação cancelada.'); await loadPrivacy(); }
    setBusy(false);
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage('');
    const result = await neon.rpc('set_data_retention_policy',{
      p_organization_id: organizationId,
      p_data_class: dataClass,
      p_retention_days: Number(retentionDays),
      p_label: policyLabel.trim(),
      p_rationale: rationale.trim() || null,
      p_policy_status: policyStatus,
      p_legal_review_reference: legalReviewReference.trim() || null
    });
    if (result.error) setMessage(policyStatus === 'approved' ? 'A aprovação exige autorização administrativa e referência de revisão jurídica/DPO válida.' : 'Não foi possível salvar a política de retenção.');
    else { setMessage('Política registrada. Exclusão automática permanece desabilitada.'); await loadPrivacy(); }
    setBusy(false);
  }

  async function changeManagedStatus(request: PrivacyRequest,status: string) {
    const needsSummary = ['approved','partially_approved','rejected','fulfilled'].includes(status);
    const summary = needsSummary ? window.prompt('Resumo da análise/resposta (obrigatório):') : '';
    if (needsSummary && (!summary || summary.trim().length < 3)) return;
    const reference = window.prompt('Referência interna opcional (ticket/parecer/processo):') || '';
    setBusy(true); setMessage('');
    const result = await neon.rpc('update_privacy_request_status',{
      p_request_id: request.id,
      p_status: status,
      p_response_summary: summary?.trim() || null,
      p_internal_reference: reference.trim() || null
    });
    if (result.error) {
      setMessage(request.request_type === 'deletion' && status === 'fulfilled'
        ? 'Pedido de exclusão não pode ser marcado como concluído: execução de exclusão não está implementada nesta fase.'
        : 'Mudança de status não autorizada ou incompatível com o estado atual.');
    } else { setMessage('Status atualizado e auditado.'); await loadPrivacy(); }
    setBusy(false);
  }

  return (
    <section className="privacy-center">
      <div className="privacy-hero">
        <div><span className="eyebrow">PRIVACY / LGPD BY DESIGN</span><h2>Privacidade e Retenção</h2><p>Governança de solicitações e políticas. Não executa exclusão automática e não substitui validação jurídica/DPO.</p></div>
        <div className="privacy-lock"><strong>AUTO DELETE</strong><b>OFF</b><small>legal hold e retenção prevalecem</small></div>
      </div>

      <div className="privacy-notice"><strong>Regra operacional</strong><span>Pedido de exclusão inicia análise humana. Evidências sob legal hold ou retenção aplicável não são apagadas por este módulo. Nenhum prazo legal é presumido pelo sistema.</span></div>

      <label className="privacy-org">Organização
        <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>{organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
      </label>
      {message && <div className="privacy-message">{message}</div>}

      <div className="privacy-grid">
        <form className="privacy-card" onSubmit={submitRequest}>
          <h3>Nova solicitação</h3>
          <label>Tipo<select value={requestType} onChange={(e) => setRequestType(e.target.value)}>{Object.entries(requestLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Escopo da propriedade (opcional)<select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}><option value="">Organização / meus dados</option>{scopedProperties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Descrição<textarea value={requestText} maxLength={5000} onChange={(e) => setRequestText(e.target.value)} placeholder="Descreva o que deseja acessar, corrigir, exportar, restringir, excluir ou contestar." /></label>
          <button className="primary" disabled={busy || !organizationId || requestText.trim().length < 3}>Registrar solicitação</button>
          {requestType === 'deletion' && <small className="privacy-warning">Exclusão é somente uma solicitação para análise. Nenhum dado será apagado automaticamente.</small>}
        </form>

        <form className="privacy-card" onSubmit={savePolicy}>
          <h3>Política de retenção</h3>
          <p className="muted">Disponível apenas para administração autorizada. Dias configurados são governança interna e exigem validação jurídica/DPO.</p>
          <label>Classe<select value={dataClass} onChange={(e) => setDataClass(e.target.value)}>{Object.entries(dataClassLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <div className="privacy-inline"><label>Dias<input type="number" min="1" max="36500" value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} /></label><label>Status<select value={policyStatus} onChange={(e) => setPolicyStatus(e.target.value)}><option value="draft">Rascunho</option><option value="approved">Aprovada</option><option value="retired">Retirada</option></select></label></div>
          <label>Nome<input value={policyLabel} maxLength={160} onChange={(e) => setPolicyLabel(e.target.value)} /></label>
          <label>Justificativa<textarea value={rationale} maxLength={2000} onChange={(e) => setRationale(e.target.value)} /></label>
          <label>Referência de revisão jurídica/DPO<input value={legalReviewReference} maxLength={500} onChange={(e) => setLegalReviewReference(e.target.value)} placeholder={policyStatus === 'approved' ? 'Obrigatória para aprovar' : 'Opcional no rascunho'} /></label>
          <button className="secondary" disabled={busy || !organizationId}>Salvar política</button>
        </form>
      </div>

      <div className="privacy-grid">
        <div className="privacy-card privacy-list"><h3>Minhas solicitações</h3>{!myRequests.length && <p className="muted">Nenhuma solicitação registrada.</p>}{myRequests.map((r) => <article key={r.id} className="privacy-row"><div><strong>{requestLabels[r.request_type] || r.request_type}</strong><span>{r.organization_name}{r.property_name ? ` · ${r.property_name}` : ''}</span><p>{r.request_text}</p>{r.response_summary && <small>Resposta: {r.response_summary}</small>}</div><div className="privacy-row-actions"><span className={`privacy-status ${r.status}`}>{statusLabels[r.status] || r.status}</span>{['received','under_review'].includes(r.status) && <button className="secondary compact" disabled={busy} onClick={() => void cancelRequest(r.id)}>Cancelar</button>}</div></article>)}</div>

        <div className="privacy-card privacy-list"><h3>Políticas visíveis</h3>{!policies.length && <p className="muted">Nenhuma política registrada para esta organização.</p>}{policies.map((p) => <article key={p.id} className="privacy-row"><div><strong>{dataClassLabels[p.data_class] || p.data_class}</strong><span>{p.retention_days} dias · {p.label}</span><p>{p.rationale || 'Sem justificativa registrada.'}</p></div><div className="privacy-row-actions"><span className={`privacy-status ${p.policy_status}`}>{p.policy_status}</span><small>Auto delete: OFF</small></div></article>)}</div>
      </div>

      <div className="privacy-card privacy-list"><h3>Fila de governança</h3><p className="muted">Aparece apenas para Admin iFarm/Admin Organização autorizados.</p>{!managed.length && <p className="muted">Nenhuma solicitação gerenciável neste perfil.</p>}{managed.map((r) => <article key={r.id} className="privacy-row managed"><div><strong>{r.requester_name} · {requestLabels[r.request_type] || r.request_type}</strong><span>{r.organization_name}{r.property_name ? ` · ${r.property_name}` : ''}</span><p>{r.request_text}</p>{r.request_type === 'deletion' && <small className="privacy-warning">Execução de exclusão: NÃO implementada · revisão de legal hold obrigatória</small>}</div><div className="privacy-row-actions"><span className={`privacy-status ${r.status}`}>{statusLabels[r.status] || r.status}</span><select disabled={busy || ['fulfilled','cancelled'].includes(r.status)} value={r.status} onChange={(e) => void changeManagedStatus(r,e.target.value)}><option value={r.status}>{statusLabels[r.status] || r.status}</option>{['under_review','approved','partially_approved','rejected','fulfilled'].filter((s) => s !== r.status).map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}</select></div></article>)}</div>
    </section>
  );
}

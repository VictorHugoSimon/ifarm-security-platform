import { FormEvent, useEffect, useMemo, useState } from 'react';
import { neon } from './lib/neon';

type Organization={id:string;name:string};
type Neighborhood={id:string;organization_id:string;name:string};
type Property={id:string;organization_id:string;neighborhood_id?:string|null;name:string};
type Device={id:string;organization_id:string;neighborhood_id?:string|null;property_id?:string|null;name:string;device_type:string;status:string};
type Severity='informational'|'attention'|'high'|'critical';
type TicketStatus='open'|'triaged'|'in_progress'|'waiting_customer'|'resolved'|'closed';
type Ticket={id:string;organization_id:string;organization_name:string;neighborhood_id?:string|null;neighborhood_name?:string|null;property_id?:string|null;property_name?:string|null;device_id?:string|null;device_name?:string|null;opened_by_name?:string|null;assigned_to_name?:string|null;category:string;severity:Severity;status:TicketStatus;title:string;description:string;response_target_at?:string|null;resolution_target_at?:string|null;first_response_at?:string|null;resolved_at?:string|null;closed_at?:string|null;response_overdue:boolean;resolution_overdue:boolean;target_contractual:boolean;created_at:string;updated_at:string};

const severityLabels:Record<Severity,string>={informational:'Informativo',attention:'Atenção',high:'Alto',critical:'Crítico'};
const statusLabels:Record<TicketStatus,string>={open:'Aberto',triaged:'Triado',in_progress:'Em atendimento',waiting_customer:'Aguardando cliente',resolved:'Resolvido',closed:'Fechado'};
const categories=[['device','Dispositivo'],['connectivity','Conectividade'],['camera','Câmera'],['sensor','Sensor'],['gateway','Gateway'],['app','Aplicativo'],['access','Acesso'],['insurance','Insurance'],['other','Outro']] as const;

function scopeLabel(ticket:Ticket){if(ticket.property_name)return `Propriedade · ${ticket.property_name}`;if(ticket.neighborhood_name)return `Bairro · ${ticket.neighborhood_name}`;return `Organização · ${ticket.organization_name}`}
function dateLabel(value?:string|null){return value?new Date(value).toLocaleString('pt-BR'):'Sem meta configurada'}

export function SupportCenter(){
  const[organizations,setOrganizations]=useState<Organization[]>([]);const[neighborhoods,setNeighborhoods]=useState<Neighborhood[]>([]);const[properties,setProperties]=useState<Property[]>([]);const[devices,setDevices]=useState<Device[]>([]);const[tickets,setTickets]=useState<Ticket[]>([]);
  const[organizationId,setOrganizationId]=useState('');const[scopeMode,setScopeMode]=useState<'organization'|'neighborhood'|'property'>('property');const[neighborhoodId,setNeighborhoodId]=useState('');const[propertyId,setPropertyId]=useState('');const[deviceId,setDeviceId]=useState('');const[category,setCategory]=useState('device');const[severity,setSeverity]=useState<Severity>('attention');const[title,setTitle]=useState('');const[description,setDescription]=useState('');const[message,setMessage]=useState('');const[loading,setLoading]=useState(false);
  const[targetSeverity,setTargetSeverity]=useState<Severity>('attention');const[responseMinutes,setResponseMinutes]=useState('60');const[resolutionMinutes,setResolutionMinutes]=useState('480');

  const visibleNeighborhoods=useMemo(()=>neighborhoods.filter(x=>x.organization_id===organizationId),[neighborhoods,organizationId]);
  const visibleProperties=useMemo(()=>properties.filter(x=>x.organization_id===organizationId),[properties,organizationId]);
  const visibleDevices=useMemo(()=>devices.filter(d=>d.organization_id===organizationId&&(scopeMode==='organization'?true:scopeMode==='neighborhood'?d.neighborhood_id===neighborhoodId&&!d.property_id:d.property_id===propertyId)),[devices,organizationId,scopeMode,neighborhoodId,propertyId]);

  async function load(){
    const[orgs,neighs,props,devs,queue]=await Promise.all([
      neon.from('organizations').select('id,name').order('name'),
      neon.from('neighborhoods').select('id,organization_id,name').order('name'),
      neon.from('properties').select('id,organization_id,neighborhood_id,name').order('name'),
      neon.from('devices').select('id,organization_id,neighborhood_id,property_id,name,device_type,status').order('name'),
      neon.rpc('list_support_tickets',{p_organization_id:null,p_status:null,p_limit:200})
    ]);
    if(orgs.error||neighs.error||props.error||devs.error||queue.error){setMessage('Não foi possível carregar a central de suporte autorizada para esta sessão.');return}
    const orgRows=(orgs.data||[]) as Organization[];setOrganizations(orgRows);setNeighborhoods((neighs.data||[]) as Neighborhood[]);setProperties((props.data||[]) as Property[]);setDevices((devs.data||[]) as Device[]);setTickets((queue.data||[]) as Ticket[]);setOrganizationId(v=>v||orgRows[0]?.id||'');
  }
  useEffect(()=>{void load()},[]);
  useEffect(()=>{if(!visibleNeighborhoods.some(x=>x.id===neighborhoodId))setNeighborhoodId('');if(!visibleProperties.some(x=>x.id===propertyId))setPropertyId('');},[organizationId,visibleNeighborhoods,visibleProperties,neighborhoodId,propertyId]);
  useEffect(()=>{if(!visibleDevices.some(x=>x.id===deviceId))setDeviceId('')},[visibleDevices,deviceId]);

  async function createTicket(event:FormEvent){event.preventDefault();setLoading(true);setMessage('');try{const result=await neon.rpc('create_support_ticket',{p_organization_id:organizationId,p_neighborhood_id:scopeMode==='organization'?null:scopeMode==='neighborhood'?neighborhoodId||null:visibleProperties.find(x=>x.id===propertyId)?.neighborhood_id||null,p_property_id:scopeMode==='property'?propertyId||null:null,p_device_id:deviceId||null,p_category:category,p_severity:severity,p_title:title.trim(),p_description:description.trim()});if(result.error){setMessage('Não foi possível abrir o chamado neste escopo.');return}setTitle('');setDescription('');setDeviceId('');setMessage('Chamado aberto e registrado na fila operacional.');await load()}finally{setLoading(false)}}

  async function updateStatus(id:string,status:TicketStatus){setLoading(true);setMessage('');try{const note=status==='closed'?'Encerramento registrado pela central de suporte.':`Atualização operacional para ${statusLabels[status]}.`;const result=await neon.rpc('update_support_ticket_status',{p_ticket_id:id,p_status:status,p_note:note});if(result.error){setMessage('Seu perfil não pode executar esta transição ou o chamado já está encerrado.');return}await load()}finally{setLoading(false)}}

  async function saveTarget(event:FormEvent){event.preventDefault();setLoading(true);setMessage('');try{const response=Number(responseMinutes),resolution=Number(resolutionMinutes);const result=await neon.rpc('set_support_operational_target',{p_organization_id:organizationId,p_severity:targetSeverity,p_response_minutes:response,p_resolution_minutes:resolution,p_label:'Meta operacional iFarm Security'});if(result.error){setMessage('Somente administrador autorizado pode configurar metas operacionais válidas.');return}setMessage('Meta operacional salva. Ela não constitui SLA contratual.')}finally{setLoading(false)}}

  const openCount=tickets.filter(t=>!['resolved','closed'].includes(t.status)).length;const overdue=tickets.filter(t=>t.response_overdue||t.resolution_overdue).length;
  return <section id="support-center">
    <div className="section-heading"><div><span className="eyebrow">SEC-179</span><h2>Suporte e manutenção</h2></div><button className="secondary" type="button" onClick={()=>void load()} disabled={loading}>Atualizar</button></div>
    <div className="support-metrics"><article><span>Chamados visíveis</span><strong>{tickets.length}</strong></article><article><span>Em aberto</span><strong>{openCount}</strong></article><article><span>Fora da meta</span><strong>{overdue}</strong></article><article><span>SLA contratual</span><strong>NÃO</strong><small>metas são operacionais</small></article></div>
    <div className="support-layout">
      <form className="support-card" onSubmit={createTicket}><strong>Abrir chamado</strong><p>Registre falha de dispositivo, conectividade, acesso ou operação.</p>
        <label>Organização<select required value={organizationId} onChange={e=>setOrganizationId(e.target.value)}><option value="">Selecione</option>{organizations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Escopo<select value={scopeMode} onChange={e=>setScopeMode(e.target.value as typeof scopeMode)}><option value="property">Propriedade</option><option value="neighborhood">Bairro comunitário</option><option value="organization">Organização</option></select></label>
        {scopeMode==='neighborhood'&&<label>Bairro<select required value={neighborhoodId} onChange={e=>setNeighborhoodId(e.target.value)}><option value="">Selecione</option>{visibleNeighborhoods.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        {scopeMode==='property'&&<label>Propriedade<select required value={propertyId} onChange={e=>setPropertyId(e.target.value)}><option value="">Selecione</option>{visibleProperties.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <label>Dispositivo opcional<select value={deviceId} onChange={e=>setDeviceId(e.target.value)}><option value="">Sem vínculo</option>{visibleDevices.map(x=><option key={x.id} value={x.id}>{x.name} · {x.device_type}</option>)}</select></label>
        <label>Categoria<select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label>Severidade<select value={severity} onChange={e=>setSeverity(e.target.value as Severity)}>{Object.entries(severityLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label>Título<input required value={title} onChange={e=>setTitle(e.target.value)} maxLength={160}/></label>
        <label>Descrição<textarea required value={description} onChange={e=>setDescription(e.target.value)} maxLength={5000} rows={5}/></label>
        <button className="primary" disabled={loading||!organizationId}>Abrir chamado</button>
      </form>
      <form className="support-card" onSubmit={saveTarget}><strong>Meta operacional</strong><p>Define alvo de resposta/resolução. Não gera SLA contratual.</p>
        <label>Severidade<select value={targetSeverity} onChange={e=>setTargetSeverity(e.target.value as Severity)}>{Object.entries(severityLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label>Resposta (min)<input type="number" min="5" max="10080" value={responseMinutes} onChange={e=>setResponseMinutes(e.target.value)}/></label>
        <label>Resolução (min)<input type="number" min="5" max="43200" value={resolutionMinutes} onChange={e=>setResolutionMinutes(e.target.value)}/></label>
        <button className="secondary" disabled={loading||!organizationId}>Salvar meta</button><small>Somente Admin Organização/Admin iFarm. `contractual=false` é imposto pelo banco no MVP.</small>
      </form>
    </div>
    <div className="support-list">{!tickets.length&&<div className="support-empty">Nenhum chamado visível para esta sessão.</div>}{tickets.map(t=><article className={`support-ticket severity-${t.severity}`} key={t.id}><div className="support-ticket-head"><div><strong>{t.title}</strong><span>{severityLabels[t.severity]} · {statusLabels[t.status]} · {scopeLabel(t)}</span></div><small>{new Date(t.created_at).toLocaleString('pt-BR')}</small></div><p>{t.description}</p><div className="support-meta"><span>Dispositivo: {t.device_name||'não vinculado'}</span><span>Responsável: {t.assigned_to_name||'não atribuído'}</span><span className={t.response_overdue?'overdue':''}>Resposta: {dateLabel(t.response_target_at)}</span><span className={t.resolution_overdue?'overdue':''}>Resolução: {dateLabel(t.resolution_target_at)}</span></div>{t.status!=='closed'&&<div className="support-actions"><button type="button" className="secondary" onClick={()=>void updateStatus(t.id,'in_progress')} disabled={loading}>Em atendimento</button><button type="button" className="secondary" onClick={()=>void updateStatus(t.id,'waiting_customer')} disabled={loading}>Aguardar cliente</button><button type="button" className="secondary" onClick={()=>void updateStatus(t.id,'resolved')} disabled={loading}>Resolver</button>{t.status==='resolved'&&<button type="button" className="secondary" onClick={()=>void updateStatus(t.id,'closed')} disabled={loading}>Fechar</button>}</div>}</article>)}</div>
    {message&&<div className="structure-message">{message}</div>}
    <div className="map-privacy-note"><strong>Support by Design:</strong> metas exibidas são operacionais e não contratuais. O módulo não presume monitoramento humano 24×7, despacho público ou garantia de prevenção de incidentes.</div>
  </section>
}

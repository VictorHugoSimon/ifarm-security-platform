import { FormEvent, useEffect, useMemo, useState } from 'react';
import { neon } from './lib/neon';

type Organization={id:string;name:string};
type Neighborhood={id:string;organization_id:string;name:string};
type Property={id:string;organization_id:string;neighborhood_id?:string|null;name:string};
type Pilot={id:string;organization_id:string;organization_name:string;neighborhood_id:string;neighborhood_name:string;name:string;status:string;target_property_count:number;confirmed_property_count:number;installed_property_count:number;planned_start_date?:string|null;planned_end_date?:string|null;created_at:string;updated_at:string};
type Readiness={pilot_id:string;name:string;status:string;target_property_count:number;confirmed_property_count:number;installed_property_count:number;validated_property_count:number;invited_property_count:number;latest_snapshot_at?:string|null;scope_device_count:number;online_device_count:number;recent_heartbeat_count:number;device_online_now_pct?:number|null;recent_heartbeat_pct?:number|null;event_count_24h:number;validated_event_count_24h:number;rejected_event_count_24h:number;event_validation_rate_pct_24h?:number|null;event_rejection_rate_pct_24h?:number|null;avg_validation_minutes_24h?:number|null;ready_for_active:boolean};
type PilotProperty={property_id:string;property_name:string;participation_status:string;installation_status:string;confirmed_at?:string|null;installed_at?:string|null;validated_at?:string|null;notes?:string|null};
type Invitation={pilot_id:string;pilot_name:string;property_id:string;property_name:string;neighborhood_name:string;participation_status:string;invited_at:string};
type ManualObservation={id:number;metric_key:string;metric_value:number;unit:string;sample_size?:number|null;note?:string|null;source_kind:'manual';observed_at:string;recorded_by_name?:string|null};

const metricOptions=[
  ['connectivity_uptime_pct','Uptime de conectividade medido','%'],
  ['video_delivery_success_pct','Entrega de vídeo medida','%'],
  ['alert_false_positive_pct','Falsos positivos classificados manualmente','%'],
  ['installation_minutes_avg','Tempo médio de instalação','min'],
  ['user_experience_score','Experiência do usuário','1-5'],
  ['monthly_operating_cost_brl','Custo operacional mensal','R$'],
  ['mrr_potential_brl','MRR potencial','R$']
] as const;

const statusLabel:Record<string,string>={draft:'Rascunho',readiness:'Preparação',active:'Ativo',paused:'Pausado',completed:'Concluído',cancelled:'Cancelado'};
const participationLabel:Record<string,string>={invited:'Convidada',confirmed:'Confirmada',declined:'Recusada',removed:'Removida'};
const installationLabel:Record<string,string>={pending:'Pendente',scheduled:'Agendada',installed:'Instalada',validated:'Validada'};
const pct=(value?:number|null)=>value===null||value===undefined?'Sem amostra':`${Number(value).toFixed(1)}%`;
const dateTime=(value?:string|null)=>value?new Date(value).toLocaleString('pt-BR'):'Sem captura';

export function PilotCenter(){
  const[organizations,setOrganizations]=useState<Organization[]>([]);const[neighborhoods,setNeighborhoods]=useState<Neighborhood[]>([]);const[properties,setProperties]=useState<Property[]>([]);const[pilots,setPilots]=useState<Pilot[]>([]);const[invitations,setInvitations]=useState<Invitation[]>([]);
  const[selectedPilotId,setSelectedPilotId]=useState('');const[readiness,setReadiness]=useState<Readiness|null>(null);const[pilotProperties,setPilotProperties]=useState<PilotProperty[]>([]);const[manualObservations,setManualObservations]=useState<ManualObservation[]>([]);
  const[organizationId,setOrganizationId]=useState('');const[neighborhoodId,setNeighborhoodId]=useState('');const[name,setName]=useState('Piloto Bairro Rural');const[targetCount,setTargetCount]=useState('5');const[startDate,setStartDate]=useState('');const[endDate,setEndDate]=useState('');
  const[propertyId,setPropertyId]=useState('');const[metricKey,setMetricKey]=useState(metricOptions[0][0]);const[metricValue,setMetricValue]=useState('');const[sampleSize,setSampleSize]=useState('');const[metricNote,setMetricNote]=useState('');const[message,setMessage]=useState('');const[loading,setLoading]=useState(false);

  const visibleNeighborhoods=useMemo(()=>neighborhoods.filter(n=>n.organization_id===organizationId),[neighborhoods,organizationId]);
  const selectedPilot=useMemo(()=>pilots.find(p=>p.id===selectedPilotId)||null,[pilots,selectedPilotId]);
  const invitedIds=useMemo(()=>new Set(pilotProperties.filter(p=>p.participation_status!=='removed').map(p=>p.property_id)),[pilotProperties]);
  const candidateProperties=useMemo(()=>properties.filter(p=>selectedPilot&&p.organization_id===selectedPilot.organization_id&&p.neighborhood_id===selectedPilot.neighborhood_id&&!invitedIds.has(p.id)),[properties,selectedPilot,invitedIds]);
  const metricUnit=metricOptions.find(([key])=>key===metricKey)?.[2]||'';

  async function loadBase(){
    const[orgs,neighs,props,pilotRows,inviteRows]=await Promise.all([
      neon.from('organizations').select('id,name').order('name'),
      neon.from('neighborhoods').select('id,organization_id,name').order('name'),
      neon.from('properties').select('id,organization_id,neighborhood_id,name').order('name'),
      neon.rpc('list_pilot_programs',{p_organization_id:null}),
      neon.rpc('list_my_pilot_invitations')
    ]);
    if(orgs.error||neighs.error||props.error||pilotRows.error||inviteRows.error){setMessage('Não foi possível carregar o Pilot Center autorizado para esta sessão.');return}
    const orgData=(orgs.data||[]) as Organization[];const pilotData=(pilotRows.data||[]) as Pilot[];
    setOrganizations(orgData);setNeighborhoods((neighs.data||[]) as Neighborhood[]);setProperties((props.data||[]) as Property[]);setPilots(pilotData);setInvitations((inviteRows.data||[]) as Invitation[]);
    setOrganizationId(v=>v||orgData[0]?.id||'');setSelectedPilotId(v=>pilotData.some(p=>p.id===v)?v:pilotData[0]?.id||'');
  }

  async function loadPilot(id:string){
    if(!id){setReadiness(null);setPilotProperties([]);setManualObservations([]);return}
    const[ready,props,manual]=await Promise.all([
      neon.rpc('get_pilot_readiness',{p_pilot_id:id}),
      neon.rpc('list_pilot_properties',{p_pilot_id:id}),
      neon.rpc('list_pilot_manual_observations',{p_pilot_id:id,p_limit:100})
    ]);
    if(ready.error||props.error||manual.error){setMessage('Seu perfil não pode visualizar este piloto ou os dados ainda não estão disponíveis.');return}
    setReadiness(((ready.data||[])[0]||null) as Readiness|null);setPilotProperties((props.data||[]) as PilotProperty[]);setManualObservations((manual.data||[]) as ManualObservation[]);
  }

  useEffect(()=>{void loadBase()},[]);useEffect(()=>{void loadPilot(selectedPilotId)},[selectedPilotId]);
  useEffect(()=>{if(!visibleNeighborhoods.some(n=>n.id===neighborhoodId))setNeighborhoodId(visibleNeighborhoods[0]?.id||'')},[visibleNeighborhoods,neighborhoodId]);
  useEffect(()=>{if(!candidateProperties.some(p=>p.id===propertyId))setPropertyId(candidateProperties[0]?.id||'')},[candidateProperties,propertyId]);

  async function refresh(){await loadBase();if(selectedPilotId)await loadPilot(selectedPilotId)}
  async function createPilot(event:FormEvent){event.preventDefault();setLoading(true);setMessage('');try{const r=await neon.rpc('create_pilot_program',{p_organization_id:organizationId,p_neighborhood_id:neighborhoodId,p_name:name.trim(),p_target_property_count:Number(targetCount),p_planned_start_date:startDate||null,p_planned_end_date:endDate||null,p_notes:'Piloto controlado do iFarm Security; sem promessa de prevenção de crimes.'});if(r.error){setMessage('Somente Admin Organização/Admin iFarm pode criar piloto válido de 5 a 10 propriedades.');return}setMessage('Piloto criado em rascunho. As propriedades ainda precisam ser convidadas e confirmadas pelos Owners.');await loadBase();setSelectedPilotId(String(r.data||''))}finally{setLoading(false)}}
  async function inviteProperty(){if(!selectedPilotId||!propertyId)return;setLoading(true);try{const r=await neon.rpc('invite_property_to_pilot',{p_pilot_id:selectedPilotId,p_property_id:propertyId,p_notes:'Convite para piloto; participação depende de confirmação do Owner.'});if(r.error){setMessage('Não foi possível convidar esta propriedade para o piloto.');return}setMessage('Propriedade convidada. O Owner deve confirmar a participação.');await refresh()}finally{setLoading(false)}}
  async function confirmInvitation(inv:Invitation){setLoading(true);try{const r=await neon.rpc('confirm_my_property_pilot',{p_pilot_id:inv.pilot_id,p_property_id:inv.property_id});if(r.error){setMessage('Somente o Owner ativo da propriedade pode confirmar este convite.');return}setMessage('Participação da propriedade confirmada pelo Owner.');await refresh()}finally{setLoading(false)}}
  async function captureSnapshot(){if(!selectedPilotId)return;setLoading(true);try{const r=await neon.rpc('capture_pilot_system_snapshot',{p_pilot_id:selectedPilotId});if(r.error){setMessage('Somente Admin Organização/Admin iFarm pode registrar snapshot sistêmico do piloto.');return}setMessage('Snapshot sistêmico capturado a partir dos dados existentes.');await loadPilot(selectedPilotId)}finally{setLoading(false)}}
  async function setPilotStatus(status:string){if(!selectedPilotId)return;setLoading(true);try{const r=await neon.rpc('set_pilot_status',{p_pilot_id:selectedPilotId,p_status:status});if(r.error){setMessage(status==='active'?'Ativação exige entre 5 e 10 propriedades confirmadas pelo Owner.':'Transição de status não permitida para este perfil/estado.');return}setMessage(`Status do piloto atualizado para ${statusLabel[status]||status}.`);await refresh()}finally{setLoading(false)}}
  async function setInstallation(property:string,status:string){setLoading(true);try{const r=await neon.rpc('update_pilot_installation_status',{p_pilot_id:selectedPilotId,p_property_id:property,p_installation_status:status,p_note:`Atualização operacional: ${installationLabel[status]||status}.`});if(r.error){setMessage('A instalação só pode ser atualizada em propriedade confirmada por perfil autorizado.');return}await loadPilot(selectedPilotId)}finally{setLoading(false)}}
  async function recordManual(event:FormEvent){event.preventDefault();if(!selectedPilotId)return;setLoading(true);try{const value=Number(metricValue);const r=await neon.rpc('record_pilot_manual_observation',{p_pilot_id:selectedPilotId,p_metric_key:metricKey,p_metric_value:value,p_unit:metricUnit,p_sample_size:sampleSize?Number(sampleSize):null,p_note:metricNote.trim()||null,p_observed_at:new Date().toISOString()});if(r.error){setMessage('Não foi possível registrar a observação manual. Verifique faixa, amostra e permissão.');return}setMetricValue('');setSampleSize('');setMetricNote('');setMessage('Observação registrada como MANUAL; ela não será confundida com métrica sistêmica.');await loadPilot(selectedPilotId)}finally{setLoading(false)}}

  return <section id="pilot-center">
    <div className="section-heading"><div><span className="eyebrow">SEC-181</span><h2>Pilot Readiness & Observability</h2></div><button type="button" className="secondary" onClick={()=>void refresh()} disabled={loading}>Atualizar</button></div>
    <div className="map-privacy-note"><strong>Pilot by Design:</strong> o piloto mede conectividade, operação, alertas, instalação, experiência, custo e MRR potencial. Não comprova prevenção de crimes. Métricas sistêmicas e manuais permanecem separadas.</div>

    {!!invitations.length&&<div className="pilot-invitations"><h3>Convites das minhas propriedades</h3>{invitations.map(i=><article key={`${i.pilot_id}-${i.property_id}`}><div><strong>{i.pilot_name}</strong><span>{i.property_name} · {i.neighborhood_name} · {participationLabel[i.participation_status]||i.participation_status}</span></div>{i.participation_status==='invited'&&<button type="button" className="primary compact" onClick={()=>void confirmInvitation(i)} disabled={loading}>Confirmar participação</button>}</article>)}</div>}

    <div className="pilot-layout">
      <form className="pilot-card" onSubmit={createPilot}><strong>Novo piloto</strong><p>Estrutura padrão: 1 bairro e 5–10 propriedades.</p>
        <label>Organização<select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} required><option value="">Selecione</option>{organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label>Bairro<select value={neighborhoodId} onChange={e=>setNeighborhoodId(e.target.value)} required><option value="">Selecione</option>{visibleNeighborhoods.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        <label>Nome<input value={name} onChange={e=>setName(e.target.value)} maxLength={160} required/></label>
        <label>Meta de propriedades<input type="number" min="5" max="10" value={targetCount} onChange={e=>setTargetCount(e.target.value)} required/></label>
        <div className="pilot-inline"><label>Início<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label><label>Fim<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label></div>
        <button className="primary" disabled={loading||!organizationId||!neighborhoodId}>Criar piloto</button>
      </form>

      <div className="pilot-card"><strong>Pilotos visíveis</strong><p>Admin Bairro/Monitoramento têm leitura agregada; criação e gestão são da organização.</p><select value={selectedPilotId} onChange={e=>setSelectedPilotId(e.target.value)}><option value="">Nenhum</option>{pilots.map(p=><option key={p.id} value={p.id}>{p.name} · {statusLabel[p.status]||p.status}</option>)}</select>{selectedPilot&&<div className="pilot-summary"><span>{selectedPilot.neighborhood_name}</span><span>{selectedPilot.confirmed_property_count}/{selectedPilot.target_property_count} confirmadas</span><span>{selectedPilot.installed_property_count} instaladas</span></div>}</div>
    </div>

    {readiness&&<>
      <div className="pilot-metrics"><article><span>Propriedades confirmadas</span><strong>{readiness.confirmed_property_count}/{readiness.target_property_count}</strong><small>{readiness.ready_for_active?'Faixa 5–10 atingida':'Ainda fora da faixa de ativação'}</small></article><article><span>Dispositivos online agora</span><strong>{pct(readiness.device_online_now_pct)}</strong><small>{readiness.online_device_count}/{readiness.scope_device_count}</small></article><article><span>Heartbeat recente</span><strong>{pct(readiness.recent_heartbeat_pct)}</strong><small>{readiness.recent_heartbeat_count}/{readiness.scope_device_count}</small></article><article><span>Validação de eventos · 24h</span><strong>{pct(readiness.event_validation_rate_pct_24h)}</strong><small>{readiness.validated_event_count_24h}/{readiness.event_count_24h}</small></article><article><span>Eventos rejeitados · 24h</span><strong>{pct(readiness.event_rejection_rate_pct_24h)}</strong><small>rejeição humana ≠ prova de falso positivo</small></article><article><span>Tempo médio de validação</span><strong>{readiness.avg_validation_minutes_24h==null?'Sem amostra':`${Number(readiness.avg_validation_minutes_24h).toFixed(1)} min`}</strong><small>captura: {dateTime(readiness.latest_snapshot_at)}</small></article></div>
      <div className="pilot-actions"><button type="button" className="secondary" onClick={()=>void captureSnapshot()} disabled={loading}>Capturar métricas sistêmicas</button><button type="button" className="secondary" onClick={()=>void setPilotStatus('readiness')} disabled={loading}>Preparação</button><button type="button" className="primary" onClick={()=>void setPilotStatus('active')} disabled={loading||!readiness.ready_for_active}>Ativar piloto</button><button type="button" className="secondary" onClick={()=>void setPilotStatus('paused')} disabled={loading}>Pausar</button></div>

      <div className="pilot-layout">
        <div className="pilot-card"><strong>Participantes e instalação</strong><p>Convite administrativo não confirma participação; confirmação é feita pelo Owner.</p><label>Adicionar propriedade<select value={propertyId} onChange={e=>setPropertyId(e.target.value)}><option value="">Selecione</option>{candidateProperties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button type="button" className="secondary" onClick={()=>void inviteProperty()} disabled={loading||!propertyId}>Enviar convite</button><div className="pilot-property-list">{pilotProperties.map(p=><article key={p.property_id}><div><strong>{p.property_name}</strong><span>{participationLabel[p.participation_status]||p.participation_status} · {installationLabel[p.installation_status]||p.installation_status}</span></div>{p.participation_status==='confirmed'&&<div><button type="button" className="secondary compact" onClick={()=>void setInstallation(p.property_id,'installed')} disabled={loading}>Instalada</button><button type="button" className="secondary compact" onClick={()=>void setInstallation(p.property_id,'validated')} disabled={loading}>Validada</button></div>}</article>)}</div></div>

        <form className="pilot-card" onSubmit={recordManual}><strong>Observação manual</strong><p>Custos, experiência e medições externas ficam explicitamente como MANUAL.</p><label>Métrica<select value={metricKey} onChange={e=>setMetricKey(e.target.value as typeof metricKey)}>{metricOptions.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label><label>Valor<input type="number" step="0.01" min="0" value={metricValue} onChange={e=>setMetricValue(e.target.value)} required/></label><label>Unidade<input value={metricUnit} readOnly/></label><label>Amostra<input type="number" min="1" value={sampleSize} onChange={e=>setSampleSize(e.target.value)} placeholder="opcional"/></label><label>Nota<textarea rows={3} maxLength={2000} value={metricNote} onChange={e=>setMetricNote(e.target.value)}/></label><button className="secondary" disabled={loading||!metricValue}>Registrar como MANUAL</button></form>
      </div>

      <div className="pilot-observations"><h3>Últimas observações manuais</h3>{!manualObservations.length&&<div className="support-empty">Nenhuma observação manual registrada.</div>}{manualObservations.map(o=><article key={o.id}><div><strong>{metricOptions.find(([k])=>k===o.metric_key)?.[1]||o.metric_key}</strong><span>{Number(o.metric_value).toLocaleString('pt-BR')} {o.unit} · MANUAL{o.sample_size?` · amostra ${o.sample_size}`:''}</span></div><small>{dateTime(o.observed_at)} · {o.recorded_by_name||'perfil autorizado'}</small>{o.note&&<p>{o.note}</p>}</article>)}</div>
    </>}
    {message&&<div className="structure-message">{message}</div>}
  </section>
}

import { useEffect, useState } from 'react';
import { AuthGate } from './AuthGate';
import { DeviceSetup } from './DeviceSetup';
import { RuralStructure } from './RuralStructure';
import { SecurityMap } from './SecurityMap';
import { TelemetrySetup } from './TelemetrySetup';
import { neon } from './lib/neon';

const modules = [
  ['Mapa de Segurança', 'Propriedades, áreas, dispositivos e incidentes georreferenciados'],
  ['Câmeras', 'Status online/offline e pontos autorizados'],
  ['Eventos', 'Detecções, severidade e validação'],
  ['Incidentes', 'Ocorrências, ações e auditoria'],
  ['Ativos', 'Máquinas, equipamentos e geofences'],
  ['Community', 'Segurança compartilhada do bairro']
];

type Organization = { id: string; name: string; status: string };

function Dashboard() {
  const session = neon.auth.useSession();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [accessMessage, setAccessMessage] = useState('Carregando permissões…');
  const [activating, setActivating] = useState(false);

  async function loadAccess() {
    const result = await neon.from('organizations').select('id,name,status');
    if (result.error) { setAccessMessage('Não foi possível consultar as permissões.'); return; }
    const rows = (result.data || []) as Organization[];
    setOrganizations(rows);
    setAccessMessage(rows.length ? `${rows.length} organização(ões) autorizada(s)` : 'Conta autenticada, mas sem acesso ativado.');
  }

  async function claimAccess() {
    setActivating(true);
    try {
      const result = await neon.rpc('claim_my_invited_access');
      if (result.error) setAccessMessage('A ativação exige convite válido e e-mail verificado.');
      else await loadAccess();
    } finally { setActivating(false); }
  }

  useEffect(() => { void loadAccess(); }, []);

  return <div className="shell"><aside><div className="brand">iFARM <strong>SECURITY</strong></div><nav>{['Visão Geral','Estrutura Rural','Dispositivos','Mapa','Saúde da Rede','Câmeras','Eventos','Incidentes','Ativos','Bairro','Configurações'].map((item, i) => <button key={item} className={i===0?'active':''}>{item}</button>)}</nav></aside><main>
    <header><div><span className="eyebrow">CENTRAL DE SEGURANÇA RURAL</span><h1>Visão Geral</h1></div><div className="header-actions"><span className="status">● Sessão autenticada</span><button className="secondary" onClick={() => void neon.auth.signOut()}>Sair</button></div></header>
    <section className="identity-strip"><div><small>USUÁRIO</small><strong>{session.data?.user.email}</strong></div><div><small>ACESSO</small><strong>{accessMessage}</strong></div>{!organizations.length && <button className="primary compact" onClick={() => void claimAccess()} disabled={activating}>{activating ? 'Ativando…' : 'Ativar convite'}</button>}</section>
    <section className="metrics"><article><span>Organizações</span><b>{organizations.length || '—'}</b><small>com acesso RLS</small></article><article><span>Estrutura rural</span><b>5</b><small>até área/equipamento</small></article><article><span>Security Map</span><b>DEV</b><small>PostGIS + RLS</small></article><article><span>Device Health</span><b>5m</b><small>reconciliação prevista</small></article></section>
    <RuralStructure /><DeviceSetup /><TelemetrySetup /><SecurityMap />
    <section><h2>Módulos do MVP</h2><div className="grid">{modules.map(([title, text]) => <article className="module" key={title}><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <section className="notice"><strong>Security by Design</strong><p>Usuários humanos operam via Auth/RLS. Dispositivos usam credenciais próprias com hash, escopo e auditoria; nenhuma chave bruta é armazenada.</p></section>
  </main></div>;
}

export function App() { return <AuthGate><Dashboard /></AuthGate>; }

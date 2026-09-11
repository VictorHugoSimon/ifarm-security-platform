import { useEffect, useMemo, useState } from 'react';
import { AccessAuditCenter } from './AccessAuditCenter';
import { AccessManagement } from './AccessManagement';
import { AssetSecurity } from './AssetSecurity';
import { AuthGate } from './AuthGate';
import { CommunityCenter } from './CommunityCenter';
import { DeviceSetup } from './DeviceSetup';
import { EventCenter } from './EventCenter';
import { EvidenceVault } from './EvidenceVault';
import { IncidentCenter } from './IncidentCenter';
import { InsuranceCenter } from './InsuranceCenter';
import { MembershipManagement } from './MembershipManagement';
import { OperationsSOC } from './OperationsSOC';
import { RuralStructure } from './RuralStructure';
import { SecurityMap } from './SecurityMap';
import { SOSCenter } from './SOSCenter';
import { TelemetrySetup } from './TelemetrySetup';
import { neon } from './lib/neon';

const modules = [
  ['Operations / SOC', 'Saúde da rede, fila de atenção, SOS e incidentes sem presumir monitoramento humano'],
  ['Mapa de Segurança', 'Propriedades, áreas, dispositivos e incidentes georreferenciados'],
  ['iFarm SOS', 'Pedido de assistência interno com localização e incidente crítico'],
  ['Asset Security', 'Máquinas, GPS, geofence, documentos e manutenção'],
  ['Security + Insurance', 'Apólices, cotação, renovação e sinistro via parceiros habilitados'],
  ['Community', 'Participantes, pontos comunitários, rotas autorizadas e manutenção do bairro']
];

const navItems = [
  { key: 'overview', label: 'Visão Geral', title: 'Visão Geral' },
  { key: 'operations', label: 'Operações', title: 'Operations / SOC' },
  { key: 'sos', label: 'SOS', title: 'iFarm SOS' },
  { key: 'assets', label: 'Ativos', title: 'Asset Security' },
  { key: 'insurance', label: 'Insurance', title: 'Security + Insurance' },
  { key: 'community', label: 'Bairro', title: 'Bairro Rural Conectado' },
  { key: 'rural', label: 'Estrutura Rural', title: 'Estrutura Rural' },
  { key: 'devices', label: 'Dispositivos', title: 'Dispositivos' },
  { key: 'access', label: 'Acessos', title: 'Gestão de Acessos' },
  { key: 'audit', label: 'Auditoria', title: 'Auditoria de Acessos' },
  { key: 'health', label: 'Saúde da Rede', title: 'Saúde da Rede' },
  { key: 'events', label: 'Eventos e Alertas', title: 'Eventos e Alertas' },
  { key: 'incidents', label: 'Incidentes', title: 'Incident Center' },
  { key: 'evidence', label: 'Evidências', title: 'Evidence Vault' },
  { key: 'map', label: 'Mapa', title: 'Mapa de Segurança' }
] as const;

type RouteKey = typeof navItems[number]['key'];
type Organization = { id: string; name: string; status: string };

const validRoutes = new Set<RouteKey>(navItems.map((item) => item.key));

function routeFromHash(): RouteKey {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return validRoutes.has(raw as RouteKey) ? raw as RouteKey : 'overview';
}

function Overview() {
  return (
    <>
      <section className="metrics">
        <article><span>Security Map</span><b>DEV</b><small>PostGIS + RLS</small></article>
        <article><span>Operações</span><b>SOC</b><small>sem monitoramento presumido</small></article>
        <article><span>Community</span><b>OPT</b><small>adesão do proprietário</small></article>
        <article><span>Privado</span><b>LOCK</b><small>nunca herdado pelo bairro</small></article>
      </section>

      <section>
        <h2>Módulos do MVP</h2>
        <div className="grid">{modules.map(([title, text]) => <article className="module" key={title}><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>

      <section className="notice"><strong>Operations by Design</strong><p>O painel operacional agrega sinais técnicos e ocorrências autorizadas. Ele não ativa, por si só, serviço humano 24×7 nem despacho de autoridade pública.</p></section>
    </>
  );
}

function RouteContent({ route }: { route: RouteKey }) {
  switch (route) {
    case 'operations': return <OperationsSOC />;
    case 'sos': return <SOSCenter />;
    case 'assets': return <AssetSecurity />;
    case 'insurance': return <InsuranceCenter />;
    case 'community': return <CommunityCenter />;
    case 'rural': return <RuralStructure />;
    case 'devices': return <DeviceSetup />;
    case 'access': return <><AccessManagement /><MembershipManagement /></>;
    case 'audit': return <AccessAuditCenter />;
    case 'health': return <TelemetrySetup />;
    case 'events': return <EventCenter />;
    case 'incidents': return <IncidentCenter />;
    case 'evidence': return <EvidenceVault />;
    case 'map': return <SecurityMap />;
    default: return <Overview />;
  }
}

function Dashboard() {
  const session = neon.auth.useSession();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [accessMessage, setAccessMessage] = useState('Carregando permissões…');
  const [activating, setActivating] = useState(false);
  const [route, setRoute] = useState<RouteKey>(() => routeFromHash());

  const currentNav = useMemo(() => navItems.find((item) => item.key === route) || navItems[0], [route]);

  async function loadAccess() {
    const result = await neon.from('organizations').select('id,name,status');
    if (result.error) {
      setAccessMessage('Não foi possível consultar as permissões.');
      return;
    }
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
    } finally {
      setActivating(false);
    }
  }

  function navigate(nextRoute: RouteKey) {
    if (route === nextRoute && window.location.hash === `#/${nextRoute}`) return;
    window.location.hash = `/${nextRoute}`;
  }

  useEffect(() => { void loadAccess(); }, []);

  useEffect(() => {
    const applyHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', applyHash);

    const raw = window.location.hash.replace(/^#\/?/, '').trim();
    if (!validRoutes.has(raw as RouteKey)) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/overview`);
      setRoute('overview');
    }

    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  useEffect(() => {
    document.title = `${currentNav.title} · iFarm Security`;
  }, [currentNav]);

  return (
    <div className="shell">
      <aside>
        <div className="brand">iFARM <strong>SECURITY</strong></div>
        <nav aria-label="Módulos iFarm Security">
          {navItems.map((item) => (
            <button
              type="button"
              key={item.key}
              className={route === item.key ? 'active' : ''}
              aria-current={route === item.key ? 'page' : undefined}
              onClick={() => navigate(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main>
        <header>
          <div><span className="eyebrow">CENTRAL DE SEGURANÇA RURAL</span><h1>{currentNav.title}</h1></div>
          <div className="header-actions"><span className="status">● Sessão autenticada</span><button className="secondary" onClick={() => void neon.auth.signOut()}>Sair</button></div>
        </header>

        <section className="identity-strip">
          <div><small>USUÁRIO</small><strong>{session.data?.user.email}</strong></div>
          <div><small>ACESSO</small><strong>{accessMessage}</strong></div>
          {!organizations.length && <button className="primary compact" onClick={() => void claimAccess()} disabled={activating}>{activating ? 'Ativando…' : 'Ativar convite'}</button>}
        </section>

        <div className="route-page" data-route={route}>
          <RouteContent route={route} />
        </div>
      </main>
    </div>
  );
}

export function App() {
  return <AuthGate><Dashboard /></AuthGate>;
}

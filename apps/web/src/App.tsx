const modules = [
  ['Mapa de Segurança', 'Propriedades, vias, câmeras e incidentes'],
  ['Câmeras', 'Status online/offline e pontos autorizados'],
  ['Eventos', 'Detecções, severidade e validação'],
  ['Incidentes', 'Ocorrências, ações e auditoria'],
  ['Ativos', 'Máquinas, equipamentos e geofences'],
  ['Community', 'Segurança compartilhada do bairro']
];

export function App() {
  return (
    <div className="shell">
      <aside>
        <div className="brand">iFARM <strong>SECURITY</strong></div>
        <nav>
          {['Visão Geral','Mapa','Câmeras','Eventos','Incidentes','Ativos','Bairro','Configurações'].map((item, i) =>
            <button key={item} className={i===0?'active':''}>{item}</button>
          )}
        </nav>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">CENTRAL DE SEGURANÇA RURAL</span>
            <h1>Visão Geral</h1>
          </div>
          <span className="status">● Plataforma operacional</span>
        </header>
        <section className="metrics">
          <article><span>Propriedades</span><b>—</b><small>aguardando piloto</small></article>
          <article><span>Câmeras</span><b>—</b><small>nenhum dispositivo</small></article>
          <article><span>Alertas críticos</span><b>0</b><small>últimas 24h</small></article>
          <article><span>Uptime</span><b>—</b><small>telemetria pendente</small></article>
        </section>
        <section>
          <h2>Módulos do MVP</h2>
          <div className="grid">
            {modules.map(([title, text]) => <article className="module" key={title}><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </section>
        <section className="notice">
          <strong>Ambiente inicial</strong>
          <p>Base técnica criada. Dados reais, vídeo e integrações externas permanecem desabilitados até configuração e autorização específicas.</p>
        </section>
      </main>
    </div>
  );
}

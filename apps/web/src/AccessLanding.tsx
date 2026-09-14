type AccessLandingState='loading'|'pending'|'error';

type Props={
  email?:string|null;
  state:AccessLandingState;
  message:string;
  activating:boolean;
  onActivate:()=>void;
  onRetry:()=>void;
  onSignOut:()=>void;
};

export function AccessLanding({email,state,message,activating,onActivate,onRetry,onSignOut}:Props){
  const loading=state==='loading';
  const error=state==='error';
  return <main className="access-landing-shell" data-access-state={state}>
    <section className="access-landing-card">
      <div className="brand access-landing-brand">iFARM <strong>SECURITY</strong></div>
      <span className="eyebrow">PORTAL PRIVADO · ACESSO CONTROLADO</span>
      <h1>{loading?'Validando acesso…':error?'Não foi possível validar o acesso':'Acesso ainda não ativado'}</h1>
      <p>{message}</p>
      {email&&<div className="access-landing-identity"><small>SESSÃO AUTENTICADA</small><strong>{email}</strong></div>}
      {!loading&&!error&&<div className="access-landing-note"><strong>Como funciona</strong><p>O portal não possui cadastro público. Se existir um convite válido para esta conta verificada, a ativação vinculará somente os escopos previamente autorizados. A resposta permanece genérica para não revelar convites, organizações ou usuários existentes.</p></div>}
      {error&&<div className="access-landing-note"><strong>Fail-closed</strong><p>Enquanto as permissões não puderem ser validadas, nenhum dashboard, mapa, câmera, evento ou outro módulo é carregado.</p></div>}
      <div className="access-landing-actions">
        {!loading&&!error&&<button className="primary" type="button" onClick={onActivate} disabled={activating}>{activating?'Ativando…':'Ativar convite'}</button>}
        {error&&<button className="primary" type="button" onClick={onRetry}>Tentar novamente</button>}
        <button className="secondary" type="button" onClick={onSignOut}>Sair</button>
      </div>
      <small className="access-landing-foot">Nenhum acesso é concedido pela interface. RLS, memberships ativos e validações server-side continuam sendo a autoridade.</small>
    </section>
  </main>
}

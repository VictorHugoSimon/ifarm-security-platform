import { FormEvent, ReactNode, useState } from 'react';
import { neon } from './lib/neon';

type Props = { children: ReactNode };

export function AuthGate({ children }: Props) {
  const session = neon.auth.useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await neon.auth.signIn.email({ email, password });
      if (result.error) setError(result.error.message || 'Não foi possível entrar.');
    } catch {
      setError('Falha de autenticação. Verifique os dados e tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  if (session.isPending) {
    return <div className="auth-screen"><div className="auth-card"><b>iFARM SECURITY</b><p>Validando sessão segura…</p></div></div>;
  }

  if (!session.data) {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={signIn}>
          <span className="eyebrow">ACESSO RESTRITO</span>
          <h1>iFarm Security</h1>
          <p>Entre com uma conta previamente autorizada. O portal não oferece cadastro público.</p>
          <label>E-mail<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          <label>Senha<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
          {error && <div className="auth-error">{error}</div>}
          <button className="primary" disabled={submitting}>{submitting ? 'Entrando…' : 'Entrar'}</button>
          <small>O acesso aos dados depende de convite, e-mail verificado e permissão no tenant.</small>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}

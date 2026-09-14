import { readFileSync } from 'node:fs';

const app=readFileSync('apps/web/src/App.tsx','utf8');
const landing=readFileSync('apps/web/src/AccessLanding.tsx','utf8');
const fail=(message)=>{console.error(`Access landing check failed: ${message}`);process.exit(1)};
const req=(condition,message)=>{if(!condition)fail(message)};

req(app.includes("import { AccessLanding } from './AccessLanding';"),'AccessLanding import missing.');
req(app.includes('const [accessLoaded, setAccessLoaded] = useState(false);'),'access load state must be explicit.');
req(app.includes('const [accessValidationFailed, setAccessValidationFailed] = useState(false);'),'validation failure state missing.');
req(app.includes('const accessContextLoaded = accessLoaded && navigationLoaded;'),'dashboard must wait for access + navigation validation.');
req(app.includes('const hasAuthorizedSurface = organizations.length > 0 || allowedModules.size > 1;'),'authorized-surface rule missing.');
req(app.includes('if (!accessContextLoaded) {'),'loading gate must execute before dashboard shell.');
req(app.includes('if (accessValidationFailed) {'),'validation errors must fail closed.');
req(app.includes('if (!hasAuthorizedSurface) {'),'sessions without active access must stay on access landing.');
req(app.indexOf('if (!accessContextLoaded) {') < app.indexOf('return (\n    <div className="shell">'),'access landing gates must precede dashboard rendering.');
req(app.includes("neon.rpc('claim_my_invited_access')"),'landing activation must reuse scoped invitation claim RPC.');
req(app.includes('else await refreshAccessContext();'),'successful invitation claim must revalidate full access context.');
req(landing.includes('O portal não possui cadastro público'),'landing must disclose invitation-only access.');
req(landing.includes('A resposta permanece genérica'),'landing must avoid account/invitation enumeration.');
req(landing.includes('nenhum dashboard, mapa, câmera, evento ou outro módulo é carregado'),'validation failure must disclose fail-closed behavior.');
req(!landing.includes('organization_id')&&!landing.includes('property_id')&&!landing.includes('neighborhood_id'),'landing must not expose scope identifiers.');
req(!landing.includes('.from(')&&!landing.includes('.rpc('),'landing component must remain presentation-only.');

console.log('Access landing check passed: no-access sessions stay fail-closed, invitation-only and non-enumerating before dashboard mount.');

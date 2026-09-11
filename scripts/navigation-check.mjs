import { readFileSync } from 'node:fs';

const app = readFileSync('apps/web/src/App.tsx', 'utf8');
const fail = (message) => {
  console.error(`Navigation check failed: ${message}`);
  process.exit(1);
};
const requireInvariant = (condition, message) => {
  if (!condition) fail(message);
};

for (const route of [
  'overview','operations','sos','assets','insurance','community','rural','devices','support','access','audit','health','events','incidents','evidence','map'
]) {
  requireInvariant(app.includes(`key: '${route}'`), `missing route: ${route}`);
}

for (const component of [
  '<OperationsSOC />','<SOSCenter />','<AssetSecurity />','<InsuranceCenter />','<CommunityCenter />','<RuralStructure />','<DeviceSetup />','<SupportCenter />','<AccessManagement />','<MembershipManagement />','<AccessAuditCenter />','<TelemetrySetup />','<EventCenter />','<IncidentCenter />','<EvidenceVault />','<SecurityMap />'
]) {
  requireInvariant(app.includes(component), `route component missing: ${component}`);
}

requireInvariant(app.includes("window.addEventListener('hashchange'"), 'hashchange listener is required for navigation/back-forward support.');
requireInvariant(app.includes('window.location.hash = `/${nextRoute}`'), 'navigation must write the selected module to the URL hash.');
requireInvariant(app.includes("window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/overview`)"), 'invalid/empty route must normalize to overview.');
requireInvariant(app.includes("aria-current={route === item.key ? 'page' : undefined}"), 'active navigation must expose aria-current.');
requireInvariant(app.includes('<RouteContent route={route} />'), 'dashboard must render only the selected route content.');
requireInvariant(app.includes('data-route={route}'), 'route state must be inspectable in the shell.');
requireInvariant(!app.includes("className={index === 0 ? 'active' : ''}"), 'static first-item-only active navigation is forbidden.');
requireInvariant(!app.includes('<OperationsSOC />\n        <SOSCenter />'), 'all modules must not be mounted sequentially in the dashboard.');

console.log('Navigation check passed: hash routes, active state, deep-link normalization and per-module lazy mounting contract preserved.');

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
  'overview','operations','pilot','sos','assets','insurance','community','rural','devices','support','privacy','access','audit','health','events','incidents','evidence','map'
]) {
  requireInvariant(app.includes(`key: '${route}'`), `missing route: ${route}`);
}

for (const component of [
  '<OperationsSOC />','<PilotCenter />','<SOSCenter />','<AssetSecurity />','<InsuranceCenter />','<CommunityCenter />','<RuralStructure />','<DeviceSetup />','<SupportCenter />','<PrivacyRetentionCenter />','<AccessManagement />','<MembershipManagement />','<AccessAuditCenter />','<TelemetrySetup />','<EventCenter />','<IncidentCenter />','<EvidenceVault />','<SecurityMap />'
]) {
  requireInvariant(app.includes(component), `route component missing: ${component}`);
}

requireInvariant(app.includes("window.addEventListener('hashchange'"), 'hashchange listener is required for navigation/back-forward support.');
requireInvariant(app.includes('window.location.hash = `/${nextRoute}`'), 'navigation must write the selected module to the URL hash.');
requireInvariant(app.includes("window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/overview`)"), 'invalid/unauthorized route must normalize to overview.');
requireInvariant(app.includes("aria-current={effectiveRoute === item.key ? 'page' : undefined}"), 'active authorized navigation must expose aria-current.');
requireInvariant(app.includes('const visibleNavItems = useMemo(() => navItems.filter((item) => allowedModules.has(item.key))'), 'navigation must render only capability-authorized items.');
requireInvariant(app.includes("const effectiveRoute: RouteKey = navigationLoaded && allowedModules.has(route) ? route : 'overview'"), 'route rendering must remain fail-closed until navigation capabilities load.');
requireInvariant(app.includes('<RouteContent route={effectiveRoute} />'), 'dashboard must render only the effective authorized route content.');
requireInvariant(app.includes('data-route={effectiveRoute}'), 'effective route state must be inspectable in the shell.');
requireInvariant(app.includes("if (!navigationLoaded || allowedModules.has(route)) return;"), 'unauthorized deep-links must normalize after capability load.');
requireInvariant(!app.includes("className={index === 0 ? 'active' : ''}"), 'static first-item-only active navigation is forbidden.');
requireInvariant(!app.includes('{navItems.map((item) => ('), 'full static navigation rendering is forbidden.');
requireInvariant(!app.includes('<OperationsSOC />\n        <SOSCenter />'), 'all modules must not be mounted sequentially in the dashboard.');

console.log('Navigation check passed: hash routes, access-aware active state, fail-closed deep-link normalization and authorized per-module mounting preserved.');

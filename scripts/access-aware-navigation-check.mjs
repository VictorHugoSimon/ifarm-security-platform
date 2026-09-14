import { readFileSync } from 'node:fs';

const migration=readFileSync('packages/db/migrations/0025_access_aware_navigation.sql','utf8');
const app=readFileSync('apps/web/src/App.tsx','utf8');
const fail=(message)=>{console.error(`Access-aware navigation check failed: ${message}`);process.exit(1)};
const req=(condition,message)=>{if(!condition)fail(message)};

req(migration.includes('CREATE OR REPLACE FUNCTION public.get_my_navigation_modules()'),'navigation capability RPC missing.');
req(migration.includes('SECURITY DEFINER'),'navigation capability RPC must be security definer.');
req(migration.includes('REVOKE ALL ON FUNCTION public.get_my_navigation_modules() FROM PUBLIC, anonymous, authenticated'),'RPC must revoke default/public execution before grant.');
req(migration.includes('GRANT EXECUTE ON FUNCTION public.get_my_navigation_modules() TO authenticated'),'authenticated execution grant missing.');
req(!migration.includes('organization_id AS')&&!migration.includes('property_id AS')&&!migration.includes('neighborhood_id AS'),'navigation RPC must not return scope IDs.');
req(migration.includes("SELECT 'insurance', is_platform_admin OR admin_org OR owner_role"),'insurance visibility must remain conservative.');
req(migration.includes("SELECT 'access', is_platform_admin OR admin_org OR admin_neighborhood OR owner_role"),'access management visibility must remain delegated-role only.');
req(migration.includes("SELECT 'pilot', is_platform_admin OR admin_org OR admin_neighborhood OR neighborhood_monitoring OR owner_role"),'pilot visibility must distinguish neighborhood monitoring.');
req(migration.includes("m.status='active'")&&migration.includes("u.status='active'"),'only active user/membership access may drive navigation.');

req(app.includes("neon.rpc('get_my_navigation_modules')"),'frontend must load navigation through the sanitized RPC.');
req(app.includes("new Set<RouteKey>(['overview'])"),'frontend must default fail-closed to overview only.');
req(app.includes('const visibleNavItems = useMemo(() => navItems.filter((item) => allowedModules.has(item.key))'),'menu must filter by allowed modules.');
req(app.includes("const effectiveRoute: RouteKey = navigationLoaded && allowedModules.has(route) ? route : 'overview'"),'route content must remain fail-closed until capability load.');
req(app.includes("if (!navigationLoaded || allowedModules.has(route)) return;"),'hidden deep-links must be normalized after capability load.');
req(app.includes('<RouteContent route={effectiveRoute} />'),'only effective authorized route may mount.');
req(app.includes('async function refreshAccessContext()'),'access context refresh helper must exist.');
req(app.includes('else await refreshAccessContext();'),'claiming an invitation must refresh access and navigation capabilities together.');
req(!app.includes('{navItems.map((item) => ('),'full static navigation rendering is forbidden.');

console.log('Access-aware navigation check passed: sanitized module keys, active-membership derivation, fail-closed rendering and deep-link normalization preserved.');

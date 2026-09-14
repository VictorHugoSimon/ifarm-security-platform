import { readFileSync } from 'node:fs';

const migration=readFileSync('packages/db/migrations/0024_pilot_readiness.sql','utf8');
const ui=readFileSync('apps/web/src/PilotCenter.tsx','utf8');
const app=readFileSync('apps/web/src/App.tsx','utf8');
const fail=(message)=>{console.error(`Pilot readiness check failed: ${message}`);process.exit(1)};
const req=(condition,message)=>{if(!condition)fail(message)};

for(const table of ['pilot_programs','pilot_properties','pilot_system_snapshots','pilot_manual_observations']){
  req(migration.includes(`CREATE TABLE IF NOT EXISTS public.${table}`),`missing pilot table ${table}`);
  req(migration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),`RLS missing for ${table}`);
  req(migration.includes(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anonymous, authenticated`),`direct browser access must remain revoked for ${table}`);
}

for(const rpc of ['create_pilot_program','invite_property_to_pilot','confirm_my_property_pilot','update_pilot_installation_status','set_pilot_status','capture_pilot_system_snapshot','record_pilot_manual_observation','list_pilot_programs','get_pilot_readiness','list_pilot_properties','list_my_pilot_invitations','list_pilot_manual_observations']){
  req(migration.includes(`FUNCTION public.${rpc}`),`missing pilot RPC ${rpc}`);
}

req(migration.includes('CONSTRAINT pilot_target_property_count CHECK (target_property_count BETWEEN 5 AND 10)'), 'pilot target must remain 5 to 10 properties.');
req(migration.includes("RAISE EXCEPTION 'pilot_active_requires_5_to_10_confirmed_properties'"), 'pilot activation must require 5 to 10 confirmed properties.');
req(migration.includes("m.role='owner'"), 'property confirmation must remain Owner-scoped.');
req(migration.includes("participation_status='confirmed',confirmed_at=now(),confirmed_by_user_id=v_actor"), 'confirmation must record actor and time.');
req(migration.includes("CONSTRAINT pilot_manual_source_only CHECK (source_kind='manual')"), 'manual observations must never masquerade as system metrics.');
req(migration.includes('FROM public.devices d') && migration.includes('FROM public.security_events e'), 'system snapshot must derive only from existing operational data.');
req(migration.includes("e.occurred_at>=now()-interval '24 hours'"), 'event pilot metrics must use explicit 24h window.');
req(!migration.includes('storage_key') && !migration.includes('recordings r') && !migration.includes('FROM public.evidence'), 'pilot metrics must not expose evidence/recording storage.');

req(app.includes("key: 'pilot'"),'pilot route missing.');
req(app.includes('<PilotCenter />'),'pilot component missing from route.');
for(const rpc of ['create_pilot_program','invite_property_to_pilot','confirm_my_property_pilot','capture_pilot_system_snapshot','record_pilot_manual_observation','get_pilot_readiness']){
  req(ui.includes(`'${rpc}'`),`UI must use RPC ${rpc}`);
}
req(!ui.includes(".from('pilot_programs')")&&!ui.includes(".from('pilot_properties')")&&!ui.includes(".from('pilot_system_snapshots')")&&!ui.includes(".from('pilot_manual_observations')"),'UI must not query pilot base tables directly.');
req(!ui.includes('.insert(')&&!ui.includes('.update(')&&!ui.includes('.delete('),'pilot UI must not use direct DML.');
req(ui.includes('MANUAL'),'manual observations must be explicitly labeled.');
req(ui.includes('rejeição humana ≠ prova de falso positivo'),'rejected events must not be equated automatically to false positives.');
req(ui.includes('Não comprova prevenção de crimes'),'pilot UI must not promise crime prevention.');

console.log('Pilot readiness check passed: 5-10 property pilot, owner confirmation, system/manual metric separation, scoped RPC access and no evidence leakage preserved.');

import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0022_support_maintenance.sql','utf8');
const ui = readFileSync('apps/web/src/SupportCenter.tsx','utf8');
const fail=(message)=>{console.error(`Support maintenance check failed: ${message}`);process.exit(1)};
const requireInvariant=(condition,message)=>{if(!condition)fail(message)};

for(const expected of [
  'CREATE TABLE IF NOT EXISTS public.support_operational_targets',
  'CREATE TABLE IF NOT EXISTS public.support_tickets',
  'CREATE TABLE IF NOT EXISTS public.support_ticket_actions',
  'CONSTRAINT support_target_non_contractual CHECK (contractual = false)',
  'CREATE OR REPLACE FUNCTION public.app_can_manage_support_scope',
  'CREATE OR REPLACE FUNCTION public.set_support_operational_target',
  'CREATE OR REPLACE FUNCTION public.create_support_ticket',
  'CREATE OR REPLACE FUNCTION public.update_support_ticket_status',
  'CREATE OR REPLACE FUNCTION public.add_support_ticket_note',
  'CREATE OR REPLACE FUNCTION public.assign_support_ticket',
  'CREATE OR REPLACE FUNCTION public.list_support_tickets',
  'CREATE OR REPLACE FUNCTION public.get_support_ticket_timeline',
  "m.role IN ('admin_neighborhood','technician')",
  "m.role IN ('owner','technician')",
  "RAISE EXCEPTION 'support_ticket_closed_terminal'",
  'target_contractual boolean',
  'false AS target_contractual',
  'REVOKE ALL ON TABLE public.support_operational_targets FROM PUBLIC, anonymous, authenticated',
  'REVOKE ALL ON TABLE public.support_tickets FROM PUBLIC, anonymous, authenticated',
  'REVOKE ALL ON TABLE public.support_ticket_actions FROM PUBLIC, anonymous, authenticated'
]) requireInvariant(migration.includes(expected),`migration missing invariant: ${expected}`);

requireInvariant(!/contractual\s*=\s*true/i.test(migration),'MVP must never mark support target as contractual.');
requireInvariant(!migration.includes('GRANT SELECT ON TABLE public.support_'),'browser direct SELECT on support tables is forbidden.');
requireInvariant(ui.includes("neon.rpc('create_support_ticket'"),'UI must create tickets through RPC.');
requireInvariant(ui.includes("neon.rpc('list_support_tickets'"),'UI must read queue through scoped RPC.');
requireInvariant(ui.includes("neon.rpc('set_support_operational_target'"),'operational target UI must use RPC.');
requireInvariant(!ui.includes("from('support_tickets')"),'UI must never query support_tickets directly.');
requireInvariant(ui.includes('não constitui SLA contratual')||ui.includes('não contratuais'),'UI must explicitly state targets are non-contractual.');

console.log('Support maintenance check passed: scoped RPC surface, non-contractual targets, terminal closure and no direct browser table access preserved.');

// Cosign mock API — swap these for real TideCloak / backend calls when porting.
// Endpoints follow docs/API.md (base http://localhost:8000/api/v1); mock bodies in docs/mocks/.
import { MERCHANTS, hash } from './data.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

// Real: TideCloak SDK login (IAMService.initIAM + BYOiD) — no backend call; then GET /me
export async function proveIdentity(user, onProgress) {
  for (let n = 0; n <= 14; n += 2) { onProgress && onProgress(n); await wait(110); }
  onProgress && onProgress(14);
  await wait(250);
  return { ok: true, user, session: 'tide_sess_' + user };
}

// Real: GET /records?ids= (ciphertext) → IAMService.doDecrypt([{encrypted, tags:['customer_pii']}]) in the browser
// → POST /records/access-log. For the agent, triggered by WS tool_call decrypt_records (docs/API.md §4.3, §4.6)
export async function decrypt({ identity, recordIds, roles }) {
  await wait(300);
  if (!roles.includes('_tide_customer_pii.selfdecrypt')) {
    return { ok: false, refused: true, missingRole: '_tide_customer_pii.selfdecrypt', identity };
  }
  return { ok: true, records: MERCHANTS.filter(m => recordIds.includes(m.id)) };
}

// POST /requests — every authority increase becomes a request (R2 uses PUT /admin/users/{username}/roles → 202 quorum_required)
export async function changeRequest({ requester, target, change, capability, roles, scope, duration, tier, required, eligible, flags }) {
  await wait(250);
  return { requester, target, change, capability, roles: roles || [], scope: scope || [], duration, tier, required, eligible, flags: flags || [], approvals: [], status: 'pending' };
}

// POST /requests/{id}/approve — threshold signature collection (TideGovernance adapter: real | mock)
export async function approve({ crId, approver }, onProgress) {
  onProgress && onProgress({ phase: 'verify', nodes: 0 });
  await wait(600);
  for (let n = 0; n <= 14; n++) { onProgress && onProgress({ phase: 'sign', nodes: n }); await wait(75); }
  onProgress && onProgress({ phase: 'submit', nodes: 14 });
  await wait(500);
  return { ok: true, crId, approver, sig: hash(crId + approver) + ' (14/20 ORK)' };
}

// POST /requests/{id}/deny
export async function deny({ crId, by }) { await wait(200); return { ok: true, crId, by }; }

// POST /admin/data/merchants/export — exports are ciphertext only
export async function exportTable({ table }) { await wait(400); return { ok: true, table, rows: 48201, encrypted: true }; }

// DELETE /admin/audit/{id} — always 403 tide_refused: audit events are threshold-signed
export async function deleteAuditEvent({ id }) { await wait(250); return { ok: false, refused: true, id, reason: 'T3 quorum required' }; }

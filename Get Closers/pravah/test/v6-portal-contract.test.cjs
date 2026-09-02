const assert = require('assert');

// ── 1. Role taxonomy ────────────────────────────────────────────────────────
const PORTAL_ROLES = ['client_admin', 'client_viewer', 'closer'];

assert.deepStrictEqual(
  [...PORTAL_ROLES].sort(),
  ['client_admin', 'client_viewer', 'closer'],
  'Portal roles must be exactly client_admin, client_viewer, closer'
);

for (const bad of ['admin', 'superadmin', 'owner', 'internal', 'staff', 'viewer', '']) {
  assert.ok(!PORTAL_ROLES.includes(bad), `"${bad}" must not be a portal role`);
}

// ── 2. Invitation contract ──────────────────────────────────────────────────
function validateInvitation(inv) {
  assert.ok(inv.client_id, 'Invitation must have client_id');
  assert.ok(typeof inv.email === 'string' && inv.email.trim().length > 0, 'Email must be a non-empty trimmed string');
  assert.strictEqual(inv.email, inv.email.trim(), 'Email must already be trimmed');
  assert.ok(PORTAL_ROLES.includes(inv.role), `Role "${inv.role}" must be one of the portal roles`);
  assert.ok(typeof inv.token === 'string', 'Token must be a string');
  assert.ok(/^[0-9a-f]{32,}$/.test(inv.token), 'Token must be a hex string of at least 32 characters');
  if (inv.accepted_at != null && inv.revoked_at != null) {
    throw new Error('Invitation cannot be both accepted and revoked');
  }
}

// Valid invitation
validateInvitation({
  client_id: 'c_001',
  email: 'user@example.com',
  role: 'client_admin',
  token: 'ab'.repeat(16),
  accepted_at: null,
  revoked_at: null,
});

// Accepted invitation
validateInvitation({
  client_id: 'c_002',
  email: 'viewer@example.com',
  role: 'client_viewer',
  token: 'cd'.repeat(16),
  accepted_at: '2025-01-01T00:00:00Z',
  revoked_at: null,
});

// Revoked invitation
validateInvitation({
  client_id: 'c_003',
  email: 'revoked@example.com',
  role: 'closer',
  token: 'ef'.repeat(16),
  accepted_at: null,
  revoked_at: '2025-01-02T00:00:00Z',
});

// Must reject both accepted and revoked
assert.throws(
  () => validateInvitation({
    client_id: 'c_004',
    email: 'bad@example.com',
    role: 'client_admin',
    token: '00'.repeat(16),
    accepted_at: '2025-01-01T00:00:00Z',
    revoked_at: '2025-01-02T00:00:00Z',
  }),
  /cannot be both accepted and revoked/,
  'Must reject invitation that is both accepted and revoked'
);

// Must reject invalid role
assert.throws(
  () => validateInvitation({
    client_id: 'c_005',
    email: 'hacker@example.com',
    role: 'superadmin',
    token: '11'.repeat(16),
    accepted_at: null,
    revoked_at: null,
  }),
  /must be one of the portal roles/,
  'Must reject invalid role in invitation'
);

// Must reject short token
assert.throws(
  () => validateInvitation({
    client_id: 'c_006',
    email: 'short@example.com',
    role: 'closer',
    token: 'abcd',
    accepted_at: null,
    revoked_at: null,
  }),
  /hex string of at least 32/,
  'Must reject token shorter than 32 hex chars'
);

// Must reject empty email
assert.throws(
  () => validateInvitation({
    client_id: 'c_007',
    email: '   ',
    role: 'closer',
    token: 'aa'.repeat(16),
    accepted_at: null,
    revoked_at: null,
  }),
  /non-empty trimmed/,
  'Must reject whitespace-only email'
);

// ── 3. Client isolation contract ────────────────────────────────────────────
const CLIENT_VIEWER_FORBIDDEN = ['create_lead', 'log_activity'];
const INTERNAL_FIELDS = ['internal_notes', 'internal'];

function validateClientScope(membership, dataRow) {
  assert.strictEqual(membership.client_id, dataRow.client_id,
    'Client portal user data must be scoped to their membership client_id');
}

function validateClientViewerRestrictions(role, attemptedAction) {
  if (role === 'client_viewer') {
    assert.ok(!CLIENT_VIEWER_FORBIDDEN.includes(attemptedAction),
      `client_viewer must not be allowed to call ${attemptedAction}`);
  }
}

function validateClientAdminScope(role, actionClientId, membershipClientId) {
  if (role === 'client_admin') {
    assert.strictEqual(actionClientId, membershipClientId,
      'client_admin can only act on their own client_id');
  }
}

function validateNoInternalFields(clientFacingData) {
  const keys = Object.keys(clientFacingData);
  for (const field of INTERNAL_FIELDS) {
    for (const key of keys) {
      assert.ok(!key.toLowerCase().includes(field),
        `Client-facing data must not include internal field: ${key}`);
    }
  }
}

// Scope check
validateClientScope({ client_id: 'c_100' }, { client_id: 'c_100', name: 'Lead A' });

// Viewer cannot write
for (const action of CLIENT_VIEWER_FORBIDDEN) {
  assert.throws(
    () => validateClientViewerRestrictions('client_viewer', action),
    /must not be allowed/,
    `client_viewer must be blocked from ${action}`
  );
}

// Admin scoped to own client
validateClientAdminScope('client_admin', 'c_100', 'c_100');
assert.throws(
  () => validateClientAdminScope('client_admin', 'c_200', 'c_100'),
  /only act on their own client_id/,
  'client_admin must not act on another client'
);

// No internal fields leak
validateNoInternalFields({ name: 'Lead A', status: 'active', booked_revenue: 5000 });
assert.throws(
  () => validateNoInternalFields({ name: 'Lead A', internal_notes: 'secret' }),
  /must not include internal field/,
  'internal_notes must not appear in client-facing data'
);
assert.throws(
  () => validateNoInternalFields({ name: 'Lead A', internal_rating: 3 }),
  /must not include internal field/,
  'internal_* fields must not appear in client-facing data'
);

// ── 4. Closer isolation contract ────────────────────────────────────────────
const ADMIN_ONLY_FIELDS = ['void_reason', 'internal_notes'];

function validateCloserScope(closerPlacementIds, dataRow) {
  assert.ok(closerPlacementIds.includes(dataRow.placement_id),
    'Closer must only see data for their own placement_id(s)');
}

function validateCloserCannotSeeOtherClosers(closerId, dataCloserId) {
  assert.strictEqual(closerId, dataCloserId,
    'Closer must not see other closers\' data');
}

function validateNoAdminFields(closerFacingData) {
  const keys = Object.keys(closerFacingData);
  for (const field of ADMIN_ONLY_FIELDS) {
    assert.ok(!keys.includes(field),
      `Closer-facing data must not include admin-only field: ${field}`);
  }
}

// Closer scope
validateCloserScope(['p_10', 'p_11'], { placement_id: 'p_10', sales: 3 });
assert.throws(
  () => validateCloserScope(['p_10', 'p_11'], { placement_id: 'p_99', sales: 7 }),
  /own placement_id/,
  'Closer must not see data outside their placements'
);

// Cannot see other closers
validateCloserCannotSeeOtherClosers('closer_1', 'closer_1');
assert.throws(
  () => validateCloserCannotSeeOtherClosers('closer_1', 'closer_2'),
  /must not see other closers/,
  'Closer must not see another closer\'s data'
);

// No admin-only fields
validateNoAdminFields({ total_sales: 5, verified_cash: 10000 });
assert.throws(
  () => validateNoAdminFields({ total_sales: 5, void_reason: 'testing' }),
  /must not include admin-only field.*void_reason/,
  'void_reason must not appear in closer-facing data'
);
assert.throws(
  () => validateNoAdminFields({ total_sales: 5, internal_notes: 'private' }),
  /must not include admin-only field.*internal_notes/,
  'internal_notes must not appear in closer-facing data'
);

// ── 5. Dashboard contract shapes ────────────────────────────────────────────
function validateClientPortalShape(data) {
  const required = ['active_closers', 'booked_revenue', 'verified_cash', 'open_actions'];
  for (const key of required) {
    assert.ok(key in data, `pravah_client_portal must include ${key}`);
    assert.strictEqual(typeof data[key], 'number', `${key} must be a number`);
  }
  const extra = Object.keys(data).filter(k => !required.includes(k));
  assert.strictEqual(extra.length, 0, `Unexpected fields in client portal response: ${extra.join(', ')}`);
}

function validateCloserPortalShape(data) {
  const required = ['total_sales', 'verified_cash', 'current_target', 'target_pct'];
  for (const key of required) {
    assert.ok(key in data, `pravah_closer_portal must include ${key}`);
  }
  assert.strictEqual(typeof data.total_sales, 'number', 'total_sales must be a number');
  assert.strictEqual(typeof data.verified_cash, 'number', 'verified_cash must be a number');
  assert.ok(data.current_target === null || typeof data.current_target === 'number',
    'current_target must be number or null');
  assert.ok(data.target_pct === null || typeof data.target_pct === 'number',
    'target_pct must be number or null');
  const extra = Object.keys(data).filter(k => !required.includes(k));
  assert.strictEqual(extra.length, 0, `Unexpected fields in closer portal response: ${extra.join(', ')}`);
}

// Valid client portal shape
validateClientPortalShape({ active_closers: 3, booked_revenue: 50000, verified_cash: 20000, open_actions: 7 });

// Valid closer portal shapes
validateCloserPortalShape({ total_sales: 12, verified_cash: 8000, current_target: 15000, target_pct: 53.3 });
validateCloserPortalShape({ total_sales: 0, verified_cash: 0, current_target: null, target_pct: null });

// Reject extra fields
assert.throws(
  () => validateClientPortalShape({ active_closers: 3, booked_revenue: 50000, verified_cash: 20000, open_actions: 7, secret: true }),
  /Unexpected fields/,
  'Client portal must not include extra fields'
);
assert.throws(
  () => validateCloserPortalShape({ total_sales: 1, verified_cash: 1, current_target: null, target_pct: null, internal_notes: 'x' }),
  /Unexpected fields/,
  'Closer portal must not include extra fields'
);

// ── 6. Security invariants ──────────────────────────────────────────────────
const ROLE_FLAGS = {
  client_admin:  { is_internal: false, is_admin: false },
  client_viewer: { is_internal: false, is_admin: false },
  closer:        { is_internal: false, is_admin: false },
};

for (const role of PORTAL_ROLES) {
  assert.strictEqual(ROLE_FLAGS[role].is_internal, false, `Portal role "${role}" must NOT have is_internal = true`);
  assert.strictEqual(ROLE_FLAGS[role].is_admin, false, `Portal role "${role}" must NOT have is_admin = true`);
}

const INTERNAL_ONLY_RPCS = [
  'pravah_submit_report',
  'pravah_import_stage_rows',
  'pravah_import_validate_batch',
  'pravah_revenue_record_adjustment',
];

function validateInternalRpcRejection(role, rpcName) {
  assert.ok(!PORTAL_ROLES.includes(role) || !INTERNAL_ONLY_RPCS.includes(rpcName),
    `Portal role "${role}" must be rejected from internal-only RPC "${rpcName}"`);
}

// Portal roles must be blocked from internal RPCs
for (const role of PORTAL_ROLES) {
  for (const rpc of INTERNAL_ONLY_RPCS) {
    assert.throws(
      () => validateInternalRpcRejection(role, rpc),
      /must be rejected from internal-only RPC/,
      `${role} must not call ${rpc}`
    );
  }
}

// Non-portal role can call internal RPCs (sanity check)
validateInternalRpcRejection('internal_admin', 'pravah_submit_report');

console.log('V6 portal contract checks passed.');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { parseTime, referenceCalculate } = require('./reference-scoring.cjs');
const ids = { admin: '10000000-0000-4000-8000-000000000001', pending: '10000000-0000-4000-8000-000000000002',
  member: '10000000-0000-4000-8000-000000000003', blocked: '10000000-0000-4000-8000-000000000004' };
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;`);
  const migrations = path.join(__dirname, '../supabase/migrations');
  for (const file of fs.readdirSync(migrations).sort()) await db.exec(fs.readFileSync(path.join(migrations, file), 'utf8'));
  for (const [name, id] of Object.entries(ids)) await db.query(
    'insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,now())',
    [id, `${name}@example.test`, JSON.stringify({ display_name: name, role: 'admin', status: 'approved' })]);
  await db.exec(`update public.zsm_profiles set role='admin',status='approved' where id='${ids.admin}';
    update public.zsm_profiles set status='approved' where id='${ids.member}';
    update public.zsm_profiles set status='blocked' where id='${ids.blocked}';`);
});
after(async () => { if (db) await db.close(); });
async function asUser(id, work, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
  await db.exec(`set role ${role}`);
  try { return await work(); } finally { await db.exec('reset role'); }
}
const args = (mode = 'solo', times = [['1:00.00', '1:00.99', '1:01.00', 'X']]) => ({
  p_player_count: mode === '1v1' ? 2 : 4, p_mode: mode, p_match_bo: 3, p_set_bo: 7,
  p_games: times.map((row, index) => ({ mapId: `map_${index}`, times: row }))
});
async function calculate(input) {
  const result = await db.query('select public.zsm_calculate($1,$2::jsonb,$3,$4,$5) as result',
    [input.p_player_count, JSON.stringify(input.p_games), input.p_mode, input.p_match_bo, input.p_set_bo]);
  return result.rows[0].result;
}
test('signup ignores forged role/status metadata and defaults to pending', async () => {
  const result = await db.query('select role,status,display_name from zsm_profiles where id=$1', [ids.pending]);
  assert.deepEqual(result.rows[0], { role: 'member', status: 'pending', display_name: 'pending' });
});
test('anonymous callers cannot read profiles, audit, or invoke protected RPCs', async () => {
  await asUser(null, async () => {
    for (const sql of ['select * from zsm_profiles', 'select * from zsm_access_audit', 'select zsm_get_access()',
      `select zsm_set_member_status('${ids.pending}','approved')`]) await assert.rejects(db.query(sql), { code: '42501' });
    await assert.rejects(calculate(args()), { code: '42501' });
  }, 'anon');
});
test('members only see their own profile and cannot update or self-approve', async () => {
  await asUser(ids.pending, async () => {
    assert.deepEqual((await db.query('select id from zsm_profiles')).rows, [{ id: ids.pending }]);
    assert.equal((await db.query('select * from zsm_access_audit')).rows.length, 0);
    await assert.rejects(db.query("update zsm_profiles set role='admin', status='approved'"), { code: '42501' });
    await assert.rejects(db.query('insert into zsm_profiles(id,email,display_name) values($1,$2,$3)',
      ['20000000-0000-4000-8000-000000000001', 'evil@example.test', 'evil']), { code: '42501' });
    await assert.rejects(db.query('select zsm_set_member_status($1,$2)', [ids.pending, 'approved']), { code: '42501' });
    await assert.rejects(calculate(args()), { code: '42501' });
    const access = (await db.query('select zsm_get_access() as profile')).rows[0].profile;
    assert.equal(access.status, 'pending'); assert.ok(access.last_seen_at);
  });
});
test('owner approves and blocks a member; audit records both transitions', async () => {
  await asUser(ids.admin, async () => {
    assert.equal((await db.query('select * from zsm_profiles')).rows.length, 4);
    const result = await db.query('select zsm_set_member_status($1,$2) as profile', [ids.pending, 'approved']);
    assert.equal(result.rows[0].profile.status, 'approved');
    await assert.rejects(db.query('select zsm_set_member_status($1,$2)', [ids.admin, 'blocked']), { code: '42501' });
    await assert.rejects(db.query('select zsm_set_member_status($1,$2)', [ids.pending, 'nonsense']), { code: '22023' });
  });
  await asUser(ids.pending, async () => { assert.equal((await calculate(args())).scores[0][0].score, 11); });
  await asUser(ids.admin, async () => { await db.query('select zsm_set_member_status($1,$2)', [ids.pending, 'blocked']); });
  await asUser(ids.pending, async () => {
    // Same authenticated identity/old JWT: the DB status is consulted again.
    await assert.rejects(calculate(args()), { code: '42501' });
    assert.equal((await db.query('select zsm_get_access() as p')).rows[0].p.status, 'blocked');
  });
  const audit = (await db.query("select details from zsm_access_audit where action='status_changed' order by id")).rows;
  assert.deepEqual(audit.map(row => [row.details.from, row.details.to]), [['pending', 'approved'], ['approved', 'blocked']]);
});
test('a blocked administrator loses admin reads and writes with the same identity', async () => {
  await db.query("update zsm_profiles set status='blocked' where id=$1", [ids.admin]);
  await asUser(ids.admin, async () => {
    assert.equal((await db.query('select * from zsm_profiles')).rows.length, 1);
    assert.equal((await db.query('select * from zsm_access_audit')).rows.length, 0);
    await assert.rejects(db.query('select zsm_set_member_status($1,$2)', [ids.member, 'blocked']), { code: '42501' });
    await assert.rejects(calculate(args()), { code: '42501' });
  });
  await db.query("update zsm_profiles set status='approved' where id=$1", [ids.admin]);
});
test('protected scoring preserves King Map, ties, DNF, and second boundaries', async () => {
  await asUser(ids.member, async () => {
    for (const mode of ['solo', '2v2', '3v3']) {
      const input = args(mode, [['1:00.00', '1:00.99', '1:01.00', 'X'],
        ['1:00.00', '1:00.00', '', '1:20.00'], ['', '', '', ''], ['10704', '1:07.04', 'x', 'invalid']]);
      assert.deepEqual(await calculate(input), referenceCalculate(input));
    }
  });
});
test('server parser matches the legacy formats and rejects unsafe numeric input', async () => {
  for (const value of ['', 'X', ' x ', '0', '01', '100', '10704', '1:07.04', '67.04', '67,04', '1:07:04',
    '1::04', 'abc', '1.2.3.4', '99999999999999999', '0:99.99', '1,2,3']) {
    const actual = (await db.query('select zsm_private.parse_time($1) as ms', [value])).rows[0].ms;
    assert.equal(actual === null ? null : Number(actual), parseTime(value), value);
  }
});
test('BO progression stops scoring after a set or match winner, including draws and DNF', async () => {
  await asUser(ids.member, async () => {
    const outcomes = [['1:00.00', '1:01.00'], ['X', '1:01.00'], ['X', 'X'], ['1:00.00', '1:00.00'], ['10704', '10804'], ['', '1:00.00']];
    for (const setBO of [7, 9, 11, 13]) for (const matchBO of [1, 3]) {
      for (const scenario of ['sweep', 'mixed', 'unfinished']) {
        const input = args('1v1', Array.from({ length: setBO * matchBO }, (_, i) =>
          scenario === 'sweep' ? outcomes[0] : scenario === 'unfinished' ? ['', ''] : outcomes[i % outcomes.length]));
        input.p_set_bo = setBO; input.p_match_bo = matchBO;
        assert.deepEqual(await calculate(input), referenceCalculate(input), `${setBO}/${matchBO}/${scenario}`);
      }
    }
  });
});
test('randomized regressions for 2–6 players agree with the old calculator', async () => {
  let seed = 42;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  await asUser(ids.member, async () => {
    for (let run = 0; run < 36; run++) {
      const count = 2 + next() % 5;
      const input = args(['solo', '2v2', '3v3'][run % 3], Array.from({ length: 12 }, () => Array.from({ length: count }, () => {
        const n = next(); return n % 7 === 0 ? 'X' : n % 11 === 0 ? '' : String(10000 + n % 30000);
      })));
      input.p_player_count = count;
      assert.deepEqual(await calculate(input), referenceCalculate(input));
    }
    const large = args('solo', [['0', '900719925474099', '1', 'X']]);
    assert.deepEqual(await calculate(large), referenceCalculate(large));
  });
});
test('invalid payloads are rejected before calculation', async () => {
  await asUser(ids.member, async () => {
    for (const bad of [{ p_games: [] }, { p_player_count: 7 }, { p_mode: 'admin' }, { p_games: [{}] },
      { p_match_bo: null }, { p_set_bo: 0 }, { p_games: [{ mapId: '', times: [null, '', '', ''] }] }]) {
      await assert.rejects(calculate({ ...args(), ...bad }), { code: '22023' });
    }
  });
});

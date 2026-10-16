// Browser-only test double, injected by Playwright instead of the SDK CDN response.
// There is deliberately no production flag that enables this mock.
(function () {
  const membersKey = '__zsm_test_members', sessionKey = '__zsm_test_session';
  const ids = { admin: '10000000-0000-4000-8000-000000000001', member: '10000000-0000-4000-8000-000000000003', pending: '10000000-0000-4000-8000-000000000002' };
  if (!localStorage.getItem(membersKey)) localStorage.setItem(membersKey, JSON.stringify([
    { id: ids.admin, email: 'owner@example.test', display_name: 'Koi', role: 'admin', status: 'approved', created_at: '2026-10-15T00:00:00Z' },
    { id: ids.member, email: 'member@example.test', display_name: 'Thành viên', role: 'member', status: 'approved', created_at: '2026-10-16T00:00:00Z' },
    { id: ids.pending, email: 'pending@example.test', display_name: 'Chờ duyệt', role: 'member', status: 'pending', created_at: '2026-10-17T00:00:00Z' }
  ]));
  let callback = () => {};
  const members = () => JSON.parse(localStorage.getItem(membersKey));
  const session = () => { const id = localStorage.getItem(sessionKey); return id ? { user: { id } } : null; };
  const current = () => members().find(row => row.id === session()?.user.id);
  window.__setStatus = (email, status) => localStorage.setItem(membersKey, JSON.stringify(members().map(row => row.email === email ? { ...row, status } : row)));
  window.__emitAuth = event => callback(event, session());
  window.__mockRpcCalls = [];
  window.addEventListener('storage', event => { if (event.key === sessionKey) callback(event.newValue ? 'SIGNED_IN' : 'SIGNED_OUT', session()); });
  function rpc(name, input) {
    window.__mockRpcCalls.push({ name, input });
    let aborted = false;
    const promise = new Promise(resolve => setTimeout(async () => {
      if (aborted) { resolve({ data: null, error: { code: 'ABORTED', message: 'Aborted' } }); return; }
      if (window.__networkFail) { resolve({ data: null, error: { message: 'Network error' } }); return; }
      const user = current();
      if (name === 'zsm_get_access') { resolve({ data: user || null, error: user ? null : { code: '42501' } }); return; }
      if (name === 'zsm_set_member_status') {
        if (user?.role !== 'admin' || user?.status !== 'approved') { resolve({ error: { code: '42501', message: 'ADMIN_REQUIRED' } }); return; }
        const target = members().find(row => row.id === input.p_user_id);
        if (!target || target.role === 'admin') { resolve({ error: { code: '42501' } }); return; }
        window.__setStatus(target.email, input.p_status);
        resolve({ data: { ...target, status: input.p_status }, error: null }); return;
      }
      if (name === 'zsm_calculate') {
        if (user?.status !== 'approved') { resolve({ data: null, error: { code: '42501', message: 'APPROVAL_REQUIRED' } }); return; }
        resolve({ data: await window.__referenceCalculate(input), error: null }); return;
      }
      resolve({ data: null, error: { message: 'Unknown RPC' } });
    }, window.__rpcDelay || 0));
    promise.abortSignal = signal => { signal.addEventListener('abort', () => { aborted = true; }, { once: true }); return promise; };
    return promise;
  }
  function from(table) {
    let status, start = 0, end = 24;
    const query = {
      select() { return this; }, order() { return this; }, limit() { return this; },
      range(a, b) { start = a; end = b; return this; }, eq(key, value) { if (key === 'status') status = value; return this; },
      then(resolve, reject) {
        if (window.__networkFail) return Promise.resolve({ error: { message: 'Network error' } }).then(resolve, reject);
        const user = current();
        if (table === 'zsm_access_audit') return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        const filtered = members().filter(row => (user?.role === 'admin' && user.status === 'approved' || row.id === user?.id) && (!status || row.status === status));
        return Promise.resolve({ data: filtered.slice(start, end + 1), count: filtered.length, error: null }).then(resolve, reject);
      }
    };
    return query;
  }
  window.supabase = { createClient: () => ({ rpc, from, auth: {
    onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() { callback = () => {}; } } } }; },
    async getSession() { return { data: { session: session() }, error: null }; },
    async signInWithPassword({ email, password }) {
      const user = members().find(row => row.email === email);
      if (!user || password !== 'test-password') return { data: {}, error: { message: 'Invalid login credentials' } };
      localStorage.setItem(sessionKey, user.id); callback('SIGNED_IN', session());
      return { data: { session: session() }, error: null };
    },
    async signUp({ email, options }) {
      localStorage.setItem(membersKey, JSON.stringify([...members(), { id: '10000000-0000-4000-8000-000000000009', email,
        display_name: options.data.display_name, role: 'member', status: 'pending', created_at: new Date().toISOString() }]));
      return { data: { session: null }, error: null };
    },
    async signOut() { localStorage.removeItem(sessionKey); callback('SIGNED_OUT', null); return { error: null }; },
    async resetPasswordForEmail() { return { error: null }; },
    async updateUser() { return { data: { user: current() }, error: null }; }
  } }) };
})();

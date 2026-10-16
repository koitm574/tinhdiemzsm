(function () {
  'use strict';
  const h = React.createElement;
  const { useState, useEffect, useRef, useCallback } = React;
  const config = window.ZSM_ACCESS_CONFIG || {};
  const scope = encodeURIComponent(window.location.pathname.replace(/\/index\.html$/i, '/'));
  const STATUS = { pending: 'Chờ duyệt', approved: 'Đã duyệt', blocked: 'Đã khóa' };
  const PROFILE_FIELDS = 'id,email,display_name,role,status,created_at,last_seen_at';
  const LEGACY_KEYS = [
    'zsm_lang_v11_final', 'zsm_tour_name', 'zsm_team1_name', 'zsm_team2_name',
    'zsm_game_mode_v11', 'zsm_solo_match_bo', 'zsm_solo_set_bo',
    'zsm_players_v11_final', 'zsm_games_v11_final', 'zsm_personal_records_v11_final',
    'zsm_cars_db_v1', 'zsm_pets_db_v1', 'zsm_ecus_db_v1', 'zsm_player_photos_v1',
    'zsm_banned_maps_1v1_v11', 'zsm_saved_groups_v1',
    'zsm_ratio_scoreboard', 'zsm_ratio_prematch', 'zsm_ratio_postmatch'
  ];
  let activeUserId = null;
  let client = null;
  let configurationError = '';

  function isPublicKey(key) {
    if (typeof key !== 'string' || !key) return false;
    if (key.startsWith('sb_publishable_')) return true;
    try {
      const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(payload)).role === 'anon';
    } catch (_) { return false; }
  }
  try {
    if (!/^https:\/\//.test(config.supabaseUrl || '') || !isPublicKey(config.supabasePublishableKey)) {
      configurationError = 'Website chưa mở đăng nhập. Quản trị viên cần hoàn tất cấu hình theo hướng dẫn trong kho mã nguồn.';
    } else if (!window.supabase || !window.supabase.createClient) {
      configurationError = 'Không tải được dịch vụ đăng nhập. Kiểm tra kết nối rồi tải lại trang.';
    } else {
      client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
          storageKey: `zsm_auth_${scope}_${new URL(config.supabaseUrl).host}` }
      });
    }
  } catch (_) { configurationError = 'Không khởi tạo được đăng nhập. Vui lòng liên hệ quản trị viên.'; }

  // Separate namespaces prevent one account's scoreboard appearing in another account.
  // These are local caches, never a source of authorization or an admin-role store.
  const storage = {
    activate(id) { activeUserId = id; },
    deactivate() { activeUserId = null; },
    prefix() {
      if (!activeUserId) throw new Error('AUTH_REQUIRED');
      return `zsm_account_${scope}_${activeUserId}:`;
    },
    get(key) { return localStorage.getItem(this.prefix() + key); },
    set(key, value) {
      const actualKey = this.prefix() + key;
      if (localStorage.getItem(actualKey) !== String(value)) localStorage.setItem(actualKey, String(value));
    },
    logicalKey(key) {
      if (!activeUserId || typeof key !== 'string') return null;
      const prefix = this.prefix();
      return key.startsWith(prefix) ? key.slice(prefix.length) : null;
    }
  };

  function explain(error) {
    const message = String(error && error.message || '');
    if (/invalid login credentials/i.test(message)) return 'Email hoặc mật khẩu chưa đúng.';
    if (/email not confirmed/i.test(message)) return 'Bạn cần xác nhận email trước khi đăng nhập.';
    if (/rate limit|too many requests|over_email_send_rate_limit/i.test(message)) return 'Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.';
    if (/password.*(weak|least|short)/i.test(message)) return 'Mật khẩu chưa đủ mạnh. Hãy dùng ít nhất 8 ký tự.';
    if (/ADMIN_REQUIRED|42501|permission denied/i.test(message)) return 'Bạn không có quyền thực hiện thao tác này. Hãy kiểm tra lại trạng thái tài khoản.';
    return 'Chưa thực hiện được. Hãy kiểm tra kết nối và thử lại; nếu vẫn lỗi, liên hệ quản trị viên.';
  }
  function Notice({ text, error = false }) {
    return text ? h('p', { className: `zsm-access-notice${error ? ' is-error' : ''}`, role: error ? 'alert' : 'status' }, text) : null;
  }
  function Card({ title, description, children }) {
    return h('main', { className: 'zsm-access-screen' }, h('section', { className: 'zsm-access-card' },
      h('span', { className: 'zsm-access-brand' }, 'KOI / ZINGSPEED MOBILE'),
      h('h1', null, title), description && h('p', { className: 'zsm-access-description' }, description), children));
  }
  function Button({ children, secondary = false, ...props }) {
    return h('button', { type: 'button', className: secondary ? 'zsm-access-button is-secondary' : 'zsm-access-button', ...props }, children);
  }
  function Field({ label, ...props }) {
    return h('label', { className: 'zsm-access-field' }, h('span', null, label), h('input', { required: true, ...props }));
  }
  function AuthForm({ onSession }) {
    const [mode, setMode] = useState('login');
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const redirectTo = window.location.origin + window.location.pathname;
    const changeMode = next => { setMode(next); setPassword(''); setConfirmation(''); setError(''); setNotice(''); };
    async function submit(event) {
      event.preventDefault();
      if (busy) return;
      setError(''); setNotice('');
      if (mode === 'signup' && !name.trim()) { setError('Vui lòng nhập tên hiển thị.'); return; }
      if (mode === 'signup' && password !== confirmation) { setError('Hai mật khẩu chưa khớp.'); return; }
      setBusy(true);
      try {
        if (mode === 'forgot') {
          const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
          if (result.error) throw result.error;
          setNotice('Nếu email này đã đăng ký, bạn sẽ nhận được liên kết đặt lại mật khẩu.');
        } else if (mode === 'signup') {
          const result = await client.auth.signUp({ email: email.trim(), password,
            options: { data: { display_name: name.trim() }, emailRedirectTo: redirectTo } });
          if (result.error) throw result.error;
          setPassword(''); setConfirmation('');
          if (result.data.session) onSession(result.data.session);
          else setNotice('Hãy kiểm tra email để xác nhận đăng ký. Sau đó đăng nhập và chờ quản trị viên duyệt.');
        } else {
          const result = await client.auth.signInWithPassword({ email: email.trim(), password });
          if (result.error) throw result.error;
          setPassword(''); onSession(result.data.session);
        }
      } catch (err) { setError(explain(err)); } finally { setBusy(false); }
    }
    const title = mode === 'signup' ? 'Tạo tài khoản' : mode === 'forgot' ? 'Quên mật khẩu' : 'Đăng nhập';
    return h(Card, { title, description: 'Tài khoản được quản trị viên duyệt mới có thể mở công cụ tính điểm.' },
      mode !== 'forgot' && h('div', { className: 'zsm-access-tabs', 'aria-label': 'Chọn hình thức truy cập' },
        ['login', 'signup'].map(value => h('button', { key: value, type: 'button', disabled: busy,
          'aria-pressed': mode === value, onClick: () => changeMode(value) }, value === 'login' ? 'Đăng nhập' : 'Đăng ký'))),
      h('form', { onSubmit: submit },
        mode === 'signup' && h(Field, { label: 'Tên hiển thị', name: 'display_name', autoComplete: 'nickname', maxLength: 80, value: name, onChange: e => setName(e.target.value) }),
        h(Field, { label: 'Email', name: 'email', type: 'email', autoComplete: 'email', maxLength: 254, value: email, onChange: e => setEmail(e.target.value) }),
        mode !== 'forgot' && h(Field, { label: 'Mật khẩu', name: 'password', type: 'password', autoComplete: mode === 'signup' ? 'new-password' : 'current-password',
          minLength: mode === 'signup' ? 8 : undefined, value: password, onChange: e => setPassword(e.target.value) }),
        mode === 'signup' && h(Field, { label: 'Nhập lại mật khẩu', name: 'confirmation', type: 'password', autoComplete: 'new-password', minLength: 8, value: confirmation, onChange: e => setConfirmation(e.target.value) }),
        h(Notice, { text: error, error: true }), h(Notice, { text: notice }),
        h(Button, { type: 'submit', disabled: busy }, busy ? 'Đang xử lý…' : mode === 'forgot' ? 'Gửi liên kết' : title)),
      h('div', { className: 'zsm-access-links' }, h('button', { type: 'button', disabled: busy,
        onClick: () => changeMode(mode === 'forgot' ? 'login' : 'forgot') }, mode === 'forgot' ? 'Quay lại đăng nhập' : 'Quên mật khẩu?')));
  }
  function Recovery({ onComplete, onLogout }) {
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function submit(event) {
      event.preventDefault(); if (busy) return;
      if (password !== confirmation) { setError('Hai mật khẩu chưa khớp.'); return; }
      setBusy(true); setError('');
      try {
        const result = await client.auth.updateUser({ password });
        if (result.error) throw result.error;
        setPassword(''); setConfirmation(''); onComplete();
      } catch (err) { setError(explain(err)); } finally { setBusy(false); }
    }
    return h(Card, { title: 'Đặt mật khẩu mới', description: 'Mật khẩu mới cần có ít nhất 8 ký tự.' },
      h('form', { onSubmit: submit },
        h(Field, { label: 'Mật khẩu mới', type: 'password', autoComplete: 'new-password', minLength: 8, value: password, onChange: e => setPassword(e.target.value) }),
        h(Field, { label: 'Nhập lại mật khẩu', type: 'password', autoComplete: 'new-password', minLength: 8, value: confirmation, onChange: e => setConfirmation(e.target.value) }),
        h(Notice, { text: error, error: true }), h(Button, { type: 'submit', disabled: busy }, busy ? 'Đang lưu…' : 'Lưu mật khẩu')),
      h(Button, { secondary: true, onClick: onLogout, disabled: busy }, 'Đăng xuất'));
  }
  function dateLabel(value) { return value ? new Date(value).toLocaleString('vi-VN') : 'Chưa ghi nhận'; }

  function AdminPanel({ onClose, onAccessChanged }) {
    const [rows, setRows] = useState([]), [audit, setAudit] = useState([]);
    const [status, setStatus] = useState('pending'), [page, setPage] = useState(0);
    const [total, setTotal] = useState(0), [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [refresh, setRefresh] = useState(0);
    const request = useRef(0);
    useEffect(() => {
      let alive = true;
      const sequence = ++request.current;
      async function load() {
        setLoading(true); setError('');
        try {
          let query = client.from('zsm_profiles').select(PROFILE_FIELDS, { count: 'exact' })
            .order('created_at', { ascending: false }).order('id').range(page * 25, page * 25 + 24);
          if (status !== 'all') query = query.eq('status', status);
          const [members, history] = await Promise.all([query, client.from('zsm_access_audit')
            .select('id,action,details,created_at').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(15)]);
          if (members.error) throw members.error;
          if (history.error) throw history.error;
          if (!alive || sequence !== request.current) return;
          setRows(members.data || []); setTotal(members.count || 0); setAudit(history.data || []);
        } catch (err) { if (alive) setError(explain(err)); }
        finally { if (alive) setLoading(false); }
      }
      load(); return () => { alive = false; };
    }, [status, page, refresh]);
    async function update(member, next) {
      if (busyId) return;
      if (next === 'blocked' && !window.confirm(`Khóa quyền sử dụng của ${member.email}?`)) return;
      setBusyId(member.id); setError(''); setNotice('');
      try {
        const result = await client.rpc('zsm_set_member_status', { p_user_id: member.id, p_status: next });
        if (result.error) throw result.error;
        setNotice(`${member.email}: ${STATUS[next].toLowerCase()}.`);
        setPage(0); setRefresh(n => n + 1);
      } catch (err) { setError(explain(err)); onAccessChanged(); }
      finally { setBusyId(''); }
    }
    const chooseStatus = value => { setStatus(value); setPage(0); setNotice(''); };
    return h('div', { className: 'zsm-admin-backdrop' }, h('section', { className: 'zsm-admin-panel', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'zsm-admin-title' },
      h('div', { className: 'zsm-admin-heading' }, h('div', null,
        h('span', { className: 'zsm-access-brand' }, 'QUYỀN QUẢN TRỊ'), h('h2', { id: 'zsm-admin-title', tabIndex: -1 }, 'Quản lý tài khoản')),
      h(Button, { secondary: true, onClick: onClose }, 'Đóng')),
      h('div', { className: 'zsm-admin-filters', 'aria-label': 'Lọc tài khoản' },
        ['pending', 'approved', 'blocked', 'all'].map(value => h('button', { key: value, type: 'button', 'aria-pressed': status === value, onClick: () => chooseStatus(value) }, STATUS[value] || 'Tất cả')),
        h(Button, { secondary: true, disabled: loading, onClick: () => setRefresh(n => n + 1) }, 'Tải lại')),
      h(Notice, { text: error, error: true }), h(Notice, { text: notice }),
      h('p', { className: 'zsm-admin-count', role: 'status' }, loading ? 'Đang tải danh sách…' : `${total} tài khoản · Trang ${page + 1}`),
      h('div', { className: 'zsm-admin-table-wrap' }, h('table', { className: 'zsm-admin-table' },
        h('thead', null, h('tr', null, ['Tài khoản', 'Trạng thái', 'Ngày đăng ký', 'Hoạt động gần nhất', 'Thao tác'].map(label => h('th', { key: label, scope: 'col' }, label)))),
        h('tbody', null, rows.map(member => h('tr', { key: member.id },
          h('td', null, h('strong', null, member.display_name), h('span', { className: 'zsm-admin-email' }, member.email), member.role === 'admin' && h('small', null, 'Quản trị viên')),
          h('td', null, h('span', { className: `zsm-access-badge is-${member.status}` }, STATUS[member.status])),
          h('td', null, dateLabel(member.created_at)), h('td', null, dateLabel(member.last_seen_at)),
          h('td', null, member.role === 'admin' ? 'Được bảo vệ' : h('div', { className: 'zsm-admin-actions' },
            member.status !== 'approved' && h(Button, { disabled: !!busyId, onClick: () => update(member, 'approved') }, member.status === 'blocked' ? 'Mở khóa' : 'Duyệt'),
            member.status !== 'blocked' && h(Button, { secondary: true, disabled: !!busyId, onClick: () => update(member, 'blocked') }, 'Khóa'))))))),
        !loading && !rows.length && h('p', { className: 'zsm-admin-empty' }, 'Không có tài khoản trong nhóm này.')),
      h('div', { className: 'zsm-admin-pagination' },
        h(Button, { secondary: true, disabled: loading || page === 0, onClick: () => setPage(n => n - 1) }, 'Trang trước'),
        h(Button, { secondary: true, disabled: loading || (page + 1) * 25 >= total, onClick: () => setPage(n => n + 1) }, 'Trang sau')),
      h('h3', { className: 'zsm-admin-history-title' }, 'Nhật ký duyệt và khóa gần đây'),
      h('ul', { className: 'zsm-admin-history' }, audit.map(item => h('li', { key: item.id },
        h('time', null, dateLabel(item.created_at)), ' — ', item.action === 'registered' ? 'Có tài khoản mới đăng ký.' :
          `${item.details.email || 'Tài khoản'}: ${STATUS[item.details.from] || item.details.from} → ${STATUS[item.details.to] || item.details.to}`))),
      h('p', { className: 'zsm-access-description' }, 'Hoạt động gần nhất là thời điểm trình duyệt liên hệ hệ thống, không phải số người đang online.')));
  }

  function Boundary({ children }) {
    const [state, setState] = useState({ phase: 'loading', profile: null });
    const [showAdmin, setShowAdmin] = useState(false);
    const [appVersion, setAppVersion] = useState(0);
    const [importNotice, setImportNotice] = useState('');
    const sequence = useRef(0), alive = useRef(false), sessionRef = useRef(null), recovery = useRef(false);
    const verifiedProfile = useRef(null), adminButton = useRef(null), accessRequest = useRef(null);
    const broadcast = new URLSearchParams(window.location.search).get('broadcast') === 'true';
    useEffect(() => {
      const gated = !!configurationError || state.phase !== 'approved';
      document.documentElement.classList.toggle('zsm-access-gated', gated);
      return () => document.documentElement.classList.remove('zsm-access-gated');
    }, [state.phase]);

    const check = useCallback(async (session, event) => {
      if (!alive.current) return;
      accessRequest.current?.abort();
      const current = ++sequence.current;
      const previousId = sessionRef.current && sessionRef.current.user.id;
      sessionRef.current = session;
      if (event === 'PASSWORD_RECOVERY') recovery.current = true;
      if (!session) {
        recovery.current = false; verifiedProfile.current = null; storage.deactivate(); setShowAdmin(false);
        setState({ phase: 'signedout', profile: null }); return;
      }
      if (recovery.current) { storage.deactivate(); setState({ phase: 'recovery', profile: null }); return; }
      if (previousId !== session.user.id) {
        verifiedProfile.current = null; storage.deactivate(); setShowAdmin(false);
        setState({ phase: 'loading', profile: null });
      }
      const controller = new AbortController();
      accessRequest.current = controller;
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const result = await client.rpc('zsm_get_access').abortSignal(controller.signal);
        if (result.error) throw result.error;
        if (!alive.current || current !== sequence.current) return;
        const profile = result.data;
        if (!profile || profile.id !== session.user.id || !STATUS[profile.status] || !['admin', 'member'].includes(profile.role)) throw new Error('INVALID_PROFILE');
        verifiedProfile.current = profile;
        if (profile.role !== 'admin') setShowAdmin(false);
        if (profile.status === 'approved') storage.activate(profile.id);
        else { storage.deactivate(); setShowAdmin(false); }
        setState({ phase: profile.status, profile });
      } catch (_) {
        if (!alive.current || current !== sequence.current) return;
        verifiedProfile.current = null; storage.deactivate(); setShowAdmin(false);
        setState({ phase: 'error', profile: null });
      } finally { clearTimeout(timeout); if (accessRequest.current === controller) accessRequest.current = null; }
    }, []);
    useEffect(() => {
      if (!client) return;
      alive.current = true;
      // Never await Supabase calls inside onAuthStateChange: its auth lock is held.
      let authEvent = 0;
      const { data } = client.auth.onAuthStateChange((event, session) => {
        const version = ++authEvent;
        setTimeout(() => { if (alive.current && version === authEvent) check(session, event); }, 0);
      });
      const initialEvent = authEvent;
      client.auth.getSession().then(result => {
        if (!alive.current || authEvent !== initialEvent) return;
        if (result.error) { storage.deactivate(); setState({ phase: 'error', profile: null }); }
        else check(result.data.session);
      }).catch(() => { if (alive.current) setState({ phase: 'error', profile: null }); });
      const refresh = () => { if (document.visibilityState !== 'hidden') check(sessionRef.current); };
      const denied = () => {
        storage.deactivate(); verifiedProfile.current = null;
        setState({ phase: 'loading', profile: null }); check(sessionRef.current);
      };
      const timer = setInterval(refresh, 30000);
      document.addEventListener('visibilitychange', refresh);
      window.addEventListener('online', refresh);
      window.addEventListener('zsm-access-denied', denied);
      return () => {
        alive.current = false; ++sequence.current; accessRequest.current?.abort(); data.subscription.unsubscribe(); clearInterval(timer);
        document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh);
        window.removeEventListener('zsm-access-denied', denied);
        storage.deactivate();
      };
    }, [check]);
    useEffect(() => {
      if (!showAdmin) return;
      const panel = document.querySelector('.zsm-admin-panel');
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.getElementById('zsm-admin-title')?.focus();
      const keydown = event => {
        if (event.key === 'Escape') { setShowAdmin(false); return; }
        if (event.key !== 'Tab' || !panel) return;
        const controls = Array.from(panel.querySelectorAll('button:not([disabled]),input,select,[tabindex="0"]'));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first?.focus(); }
      };
      document.addEventListener('keydown', keydown);
      return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); adminButton.current?.focus(); };
    }, [showAdmin]);

    async function logout() {
      ++sequence.current; verifiedProfile.current = null; recovery.current = false;
      accessRequest.current?.abort(); sessionRef.current = null;
      storage.deactivate(); setShowAdmin(false); setState({ phase: 'loading', profile: null });
      try {
        const result = await client.auth.signOut({ scope: 'local' });
        if (result.error) throw result.error;
        sessionRef.current = null; setState({ phase: 'signedout', profile: null });
      } catch (_) { setState({ phase: 'error', profile: null }); }
    }
    function importLegacy() {
      if (verifiedProfile.current?.role !== 'admin' || verifiedProfile.current?.status !== 'approved') return;
      if (!window.confirm('Chép bảng đấu cũ trên trình duyệt này vào tài khoản của bạn? Dữ liệu hiện tại của tài khoản trên máy này sẽ được thay thế.')) return;
      try {
        // Stage and back up first. Keep the legacy originals, even if storage fills up.
        const incoming = LEGACY_KEYS.map(key => [key, localStorage.getItem(key)]).filter(([, value]) => value !== null);
        if (!incoming.length) { setImportNotice('Không tìm thấy dữ liệu cũ trên trình duyệt này.'); return; }
        const backup = Object.fromEntries(LEGACY_KEYS.map(key => [key, storage.get(key)]));
        localStorage.setItem(storage.prefix() + `backup_${Date.now()}`, JSON.stringify(backup));
        incoming.forEach(([key, value]) => storage.set(key, value));
        setAppVersion(n => n + 1); setImportNotice('Đã chép dữ liệu cũ. Bản gốc vẫn được giữ lại.');
      } catch (_) { setImportNotice('Chưa chép được đầy đủ. Dữ liệu gốc vẫn còn; hãy kiểm tra dung lượng trình duyệt.'); }
    }
    if (configurationError) return h(Card, { title: 'Chưa thể đăng nhập', description: configurationError }, h(Button, { onClick: () => window.location.reload() }, 'Tải lại trang'));
    if (state.phase === 'loading') return h(Card, { title: 'Đang kiểm tra tài khoản…', description: 'Vui lòng chờ trong giây lát.' });
    if (state.phase === 'signedout') return h(AuthForm, { onSession: check });
    if (state.phase === 'recovery') return h(Recovery, { onLogout: logout, onComplete: () => { recovery.current = false; check(sessionRef.current); } });
    if (state.phase === 'error') return h(Card, { title: 'Chưa xác minh được quyền truy cập', description: 'Kết nối bị gián đoạn hoặc hệ thống chưa được cấu hình đầy đủ. Dữ liệu bảng đấu trên máy vẫn được giữ lại.' },
      h(Button, { onClick: () => check(sessionRef.current) }, 'Thử lại'), h(Button, { secondary: true, onClick: logout }, 'Đăng xuất'));
    if (state.phase !== 'approved') return h(Card, { title: state.phase === 'blocked' ? 'Tài khoản đã bị khóa' : 'Tài khoản đang chờ duyệt',
      description: state.phase === 'blocked' ? 'Quyền sử dụng đã được quản trị viên thu hồi. Vui lòng liên hệ quản trị viên nếu cần hỗ trợ.' : 'Bạn đã đăng nhập thành công. Quản trị viên cần duyệt tài khoản trước khi bạn mở công cụ tính điểm.' },
      h('p', { className: 'zsm-access-identity' }, state.profile.email),
      h(Button, { onClick: () => check(sessionRef.current) }, 'Kiểm tra lại'), h(Button, { secondary: true, onClick: logout }, 'Đăng xuất'));
    return h(React.Fragment, null,
      h(React.Fragment, { key: `${state.profile.id}:${appVersion}` }, children),
      h('aside', { className: `zsm-account-bar${broadcast ? ' is-broadcast' : ''}`, 'aria-label': 'Tài khoản của bạn' },
        h('div', null, h('strong', null, state.profile.display_name), h('small', null, state.profile.role === 'admin' ? 'Quản trị viên' : 'Thành viên')),
        state.profile.role === 'admin' && !broadcast && h('button', { ref: adminButton, type: 'button', onClick: () => setShowAdmin(true) }, 'Quản lý tài khoản'),
        state.profile.role === 'admin' && !broadcast && h('button', { type: 'button', onClick: importLegacy }, 'Nhập dữ liệu cũ'),
        h('button', { type: 'button', onClick: logout }, 'Đăng xuất')),
      importNotice && !broadcast && h('div', { className: 'zsm-import-notice', role: 'status' }, importNotice, h('button', { type: 'button', onClick: () => setImportNotice(''), 'aria-label': 'Đóng thông báo' }, '×')),
      showAdmin && state.profile.role === 'admin' && h(AdminPanel, { onClose: () => setShowAdmin(false), onAccessChanged: () => check(sessionRef.current) }));
  }
  async function calculate(input, signal) {
    const result = await client.rpc('zsm_calculate', input).abortSignal(signal);
    if (result.error) {
      if (result.error.code === '42501') window.dispatchEvent(new CustomEvent('zsm-access-denied'));
      throw result.error;
    }
    if (!result.data || !Array.isArray(result.data.scores)) throw new Error('INVALID_SCORE_RESPONSE');
    return result.data;
  }
  window.ZsmAccess = Object.freeze({ Boundary, storage, calculate });
})();

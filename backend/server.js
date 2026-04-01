const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'allvadmp106';
const DAY_MS = 24 * 60 * 60 * 1000;

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
app.use(express.static(path.join(__dirname, '..')));

const now = () => Date.now();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function defaultDb() {
  return {
    users: [], posts: [], comments: [], stories: [], follows: [],
    sessions: [], adminSessions: [], moderatorSessions: [], moderatorKeys: [], ipBans: []
  };
}

function ensureDbShape(db) {
  const shape = defaultDb();
  Object.keys(shape).forEach((k) => { if (!Array.isArray(db[k])) db[k] = shape[k]; });
  return db;
}

function readDb() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDb(), null, 2));
  }
  return ensureDbShape(JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')));
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');

function getClientIp(req) {
  const raw = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  return raw.split(',')[0].trim();
}

function cleanup(db) {
  const t = now();
  db.sessions = db.sessions.filter((s) => s.expiresAt > t);
  db.adminSessions = db.adminSessions.filter((s) => s.expiresAt > t);
  db.moderatorSessions = db.moderatorSessions.filter((s) => s.expiresAt > t);
  db.users.forEach((u) => {
    if (u.bannedUntil && u.bannedUntil <= t) {
      u.bannedUntil = null;
      u.bannedReason = '';
    }
  });
  db.stories = db.stories.filter((s) => s.expiresAt > t && !s.deletedAt);
  db.posts = db.posts.filter((p) => !(p.deletedAt && p.restoreUntil && p.restoreUntil <= t));
  db.comments = db.comments.filter((c) => !(c.deletedAt && c.restoreUntil && c.restoreUntil <= t));
}

function findUserBySession(db, token) {
  const s = db.sessions.find((x) => x.token === token && x.expiresAt > now());
  if (!s) return null;
  return { session: s, user: db.users.find((u) => u.id === s.userId) };
}

function shellPage(title, body, extra = '') {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
  :root{--bg:#070b14;--panel:#0f172a;--line:#263246;--txt:#e2e8f0;--muted:#94a3b8;--primary:#2563eb;--danger:#ef4444;--ok:#22c55e}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font-family:Inter,system-ui,sans-serif}
  .layout{display:grid;grid-template-columns:240px 1fr;min-height:100vh}.side{border-right:1px solid var(--line);padding:16px;background:#0b1222}
  .brand{font-weight:800;margin-bottom:12px}.menu a{display:block;padding:10px 12px;margin:6px 0;border-radius:10px;color:var(--txt);text-decoration:none;background:#121c31}
  .menu a.active{background:var(--primary)}.main{padding:16px}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.muted{color:var(--muted);font-size:12px}
  input,select,button,textarea{width:100%;padding:9px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:var(--txt)}
  button{background:var(--primary);border-color:var(--primary);font-weight:700;cursor:pointer}.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px;border-bottom:1px solid #243047;text-align:left;vertical-align:top}
  .pill{padding:3px 8px;border-radius:999px;background:#1f2937;display:inline-block}.danger{background:var(--danger)!important;border-color:var(--danger)!important}
  @media (max-width:900px){.layout{grid-template-columns:1fr}.side{position:sticky;top:0;z-index:2}}
  </style>${extra}</head><body>${body}</body></html>`;
}

function adminPage(db) {
  const stats = {
    users: db.users.length,
    posts: db.posts.filter((p) => !p.deletedAt).length,
    comments: db.comments.filter((c) => !c.deletedAt).length,
    keys: db.moderatorKeys.length
  };
  return shellPage('VP Admin', `<div class="layout"><aside class="side"><div class="brand">VP Admin</div><nav class="menu">
    <a href="#overview" class="active" data-tab="overview">Обзор</a>
    <a href="#posts" data-tab="posts">Посты</a>
    <a href="#comments" data-tab="comments">Комментарии</a>
    <a href="#users" data-tab="users">Пользователи</a>
    <a href="#keys" data-tab="keys">Ключи доступа</a>
    <a href="#ip" data-tab="ip">IP баны</a>
  </nav><p class="muted">Маршрут: /06adm → /admin</p></aside>
  <main class="main">
    <section id="overview" class="tab"><div class="grid"><div class="card"><h3>Пользователи</h3><div>${stats.users}</div></div><div class="card"><h3>Посты</h3><div>${stats.posts}</div></div><div class="card"><h3>Комментарии</h3><div>${stats.comments}</div></div><div class="card"><h3>Ключи</h3><div>${stats.keys}</div></div></div></section>
    <section id="posts" class="tab" hidden><div class="card"><h3>Модерация постов</h3><table id="postsTable"></table></div></section>
    <section id="comments" class="tab" hidden><div class="card"><h3>Модерация комментариев</h3><table id="commentsTable"></table></div></section>
    <section id="users" class="tab" hidden><div class="card"><h3>Модерация пользователей</h3><table id="usersTable"></table></div></section>
    <section id="keys" class="tab" hidden><div class="card"><h3>Ключи доступа</h3><div class="row"><input id="keyName" placeholder="Имя модератора"><button id="createKey">Создать ключ</button></div><table id="keysTable"></table></div></section>
    <section id="ip" class="tab" hidden><div class="card"><h3>IP баны</h3><div class="row"><input id="ipValue" placeholder="IP"><input id="ipReason" placeholder="Причина"></div><button id="banIp">Перманентно заблокировать IP</button><table id="ipTable"></table></div></section>
  </main></div>
  <script>
  const q=(s)=>document.querySelector(s);const qa=(s)=>[...document.querySelectorAll(s)];
  function switchTab(tab){qa('.tab').forEach(t=>t.hidden=t.id!==tab);qa('.menu a').forEach(a=>a.classList.toggle('active',a.dataset.tab===tab));}
  qa('.menu a').forEach(a=>a.onclick=(e)=>{e.preventDefault();switchTab(a.dataset.tab);if(a.dataset.tab!=='overview') load();});
  async function api(url,opt={}){const r=await fetch(url,{headers:{'content-type':'application/json'},credentials:'include',...opt});if(!r.ok) throw new Error(await r.text());return r.json();}
  function btn(label,fn,cls=''){return '<button class="'+cls+'" data-act="'+fn+'">'+label+'</button>'}
  async function load(){
    const posts=await api('/api/admin/posts?includeDeleted=1');
    q('#postsTable').innerHTML='<tr><th>ID</th><th>Автор</th><th>Текст</th><th>Статус</th><th>Действие</th></tr>'+posts.items.map(p=>'<tr><td>'+p.id+'</td><td>'+p.authorId+'</td><td>'+(p.text||'')+'</td><td>'+(p.deletedAt?'Удален':'Активен')+'</td><td>'+(p.deletedAt?btn('Восстановить','restore-post:'+p.id):btn('Удалить','delete-post:'+p.id,'danger'))+'</td></tr>').join('');
    const comments=await api('/api/admin/comments?includeDeleted=1');
    q('#commentsTable').innerHTML='<tr><th>ID</th><th>Пост</th><th>Текст</th><th>Статус</th><th>Действие</th></tr>'+comments.items.map(c=>'<tr><td>'+c.id+'</td><td>'+c.postId+'</td><td>'+(c.text||'')+'</td><td>'+(c.deletedAt?'Удален':'Активен')+'</td><td>'+(c.deletedAt?btn('Восстановить','restore-comment:'+c.id):btn('Удалить','delete-comment:'+c.id,'danger'))+'</td></tr>').join('');
    const users=await api('/api/admin/users');
    q('#usersTable').innerHTML='<tr><th>ID</th><th>Username</th><th>Бан</th><th>Причина</th><th>Действие</th></tr>'+users.items.map(u=>'<tr><td>'+u.id+'</td><td>'+u.username+'</td><td>'+(u.bannedUntil?new Date(u.bannedUntil).toLocaleString():'—')+'</td><td>'+(u.bannedReason||'—')+'</td><td>'+(u.bannedUntil?btn('Разбан','unban:'+u.id):btn('Бан 24ч','ban:'+u.id,'danger'))+'</td></tr>').join('');
    const keys=await api('/api/admin/keys');
    q('#keysTable').innerHTML='<tr><th>Имя</th><th>Код</th><th>Статус</th><th>Действия</th></tr>'+keys.items.map(k=>'<tr><td>'+k.name+'</td><td><span class="pill">'+k.code+'</span></td><td>'+(k.blocked?'Заблокирован':'Активен')+'</td><td>'+(k.blocked?'':btn('Блок','block-key:'+k.id,'danger'))+' '+btn('Удалить','delete-key:'+k.id,'danger')+'</td></tr>').join('');
    const ip=await api('/api/admin/ip-bans');
    q('#ipTable').innerHTML='<tr><th>IP</th><th>Причина</th><th>Статус</th><th>Действие</th></tr>'+ip.items.map(b=>'<tr><td>'+b.ip+'</td><td>'+b.reason+'</td><td>'+(b.active?'Активен':'Снят')+'</td><td>'+(b.active?btn('Снять','unban-ip:'+b.id):'')+'</td></tr>').join('');
  }
  document.body.addEventListener('click', async (e)=>{const a=e.target.dataset.act;if(!a) return;const [act,val]=a.split(':');
    if(act==='delete-post') await api('/api/admin/posts/'+val+'/delete',{method:'POST'});
    if(act==='restore-post') await api('/api/admin/posts/'+val+'/restore',{method:'POST'});
    if(act==='delete-comment') await api('/api/admin/comments/'+val+'/delete',{method:'POST'});
    if(act==='restore-comment') await api('/api/admin/comments/'+val+'/restore',{method:'POST'});
    if(act==='ban') await api('/api/admin/users/'+val+'/ban',{method:'POST',body:JSON.stringify({durationMs:86400000,reason:'Нарушение правил'})});
    if(act==='unban') await api('/api/admin/users/'+val+'/unban',{method:'POST'});
    if(act==='block-key') await api('/api/admin/keys/'+val+'/block',{method:'POST',body:JSON.stringify({reason:'Доступ ограничен'})});
    if(act==='delete-key') await api('/api/admin/keys/'+val,{method:'DELETE'});
    if(act==='unban-ip') await api('/api/admin/ip-ban/'+val+'/disable',{method:'POST'});
    await load();
  });
  q('#createKey').onclick=async()=>{await api('/api/admin/keys',{method:'POST',body:JSON.stringify({name:q('#keyName').value||'Moderator'})});q('#keyName').value='';load();};
  q('#banIp').onclick=async()=>{await api('/api/admin/ip-ban',{method:'POST',body:JSON.stringify({ip:q('#ipValue').value,reason:q('#ipReason').value||'Нарушение правил'})});q('#ipValue').value='';q('#ipReason').value='';load();};
  </script>`);
}

function moderatorPage() {
  return shellPage('VP Moderator', `<div class="layout"><aside class="side"><div class="brand">VP Moderator</div><nav class="menu">
  <a href="#posts" class="active" data-tab="posts">Посты</a><a href="#comments" data-tab="comments">Комментарии</a><a href="#users" data-tab="users">Пользователи</a>
  </nav><p class="muted">Маршрут: /mdr → /moderator</p></aside><main class="main">
  <section id="posts" class="tab"><div class="card"><h3>Посты</h3><table id="postsTable"></table></div></section>
  <section id="comments" class="tab" hidden><div class="card"><h3>Комментарии</h3><table id="commentsTable"></table></div></section>
  <section id="users" class="tab" hidden><div class="card"><h3>Пользователи</h3><table id="usersTable"></table></div></section>
  </main></div>
  <script>
  const q=(s)=>document.querySelector(s),qa=(s)=>[...document.querySelectorAll(s)];
  function sw(tab){qa('.tab').forEach(t=>t.hidden=t.id!==tab);qa('.menu a').forEach(a=>a.classList.toggle('active',a.dataset.tab===tab));}
  qa('.menu a').forEach(a=>a.onclick=(e)=>{e.preventDefault();sw(a.dataset.tab);load();});
  async function api(url,opt={}){const r=await fetch(url,{headers:{'content-type':'application/json'},credentials:'include',...opt});if(!r.ok) throw new Error(await r.text());return r.json();}
  async function load(){
    const posts=await api('/api/moderator/posts?includeDeleted=1');
    q('#postsTable').innerHTML='<tr><th>ID</th><th>Текст</th><th>Статус</th><th>Действие</th></tr>'+posts.items.map(p=>'<tr><td>'+p.id+'</td><td>'+(p.text||'')+'</td><td>'+(p.deletedAt?'Удален':'Активен')+'</td><td>'+(p.deletedAt?'':'<button data-act="delete-post:'+p.id+'" class="danger">Удалить</button>')+'</td></tr>').join('');
    const comments=await api('/api/moderator/comments?includeDeleted=1');
    q('#commentsTable').innerHTML='<tr><th>ID</th><th>Текст</th><th>Статус</th><th>Действие</th></tr>'+comments.items.map(c=>'<tr><td>'+c.id+'</td><td>'+(c.text||'')+'</td><td>'+(c.deletedAt?'Удален':'Активен')+'</td><td>'+(c.deletedAt?'':'<button data-act="delete-comment:'+c.id+'" class="danger">Удалить</button>')+'</td></tr>').join('');
    const users=await api('/api/moderator/users');
    q('#usersTable').innerHTML='<tr><th>ID</th><th>Username</th><th>Бан</th><th>Действие</th></tr>'+users.items.map(u=>'<tr><td>'+u.id+'</td><td>'+u.username+'</td><td>'+(u.bannedUntil?new Date(u.bannedUntil).toLocaleString():'—')+'</td><td>'+(u.bannedUntil?'<button data-act="unban:'+u.id+'">Разбан</button>':'<button data-act="ban:'+u.id+'" class="danger">Бан 24ч</button>')+'</td></tr>').join('');
  }
  document.body.addEventListener('click', async(e)=>{const x=e.target.dataset.act;if(!x) return;const [a,id]=x.split(':');
    if(a==='delete-post') await api('/api/moderator/posts/'+id+'/delete',{method:'POST'});
    if(a==='delete-comment') await api('/api/moderator/comments/'+id+'/delete',{method:'POST'});
    if(a==='ban') await api('/api/moderator/users/'+id+'/ban',{method:'POST',body:JSON.stringify({durationMs:86400000,reason:'Нарушение правил'})});
    if(a==='unban') await api('/api/moderator/users/'+id+'/unban',{method:'POST'});
    load();
  });
  load();
  </script>`);
}

function auth(req, res, next) {
  const db = readDb(); cleanup(db);
  const found = findUserBySession(db, req.cookies.vp_session);
  if (!found || !found.user) return res.status(401).json({ error: 'unauthorized' });
  req.db = db; req.user = found.user; req.session = found.session;
  next();
}

function adminAuth(req, res, next) {
  const db = readDb(); cleanup(db);
  const token = req.cookies.vp_admin_session;
  const ok = db.adminSessions.find((s) => s.token === token && s.expiresAt > now());
  if (!ok) return res.status(401).json({ error: 'admin_unauthorized' });
  req.db = db;
  next();
}

function moderatorAuth(req, res, next) {
  const db = readDb(); cleanup(db);
  const token = req.cookies.vp_mdr_session;
  const s = db.moderatorSessions.find((x) => x.token === token && x.expiresAt > now());
  if (!s) return res.status(401).json({ error: 'moderator_unauthorized' });
  const key = db.moderatorKeys.find((k) => k.id === s.keyId);
  if (!key || key.blocked) return res.status(403).json({ error: 'key_blocked', reason: key?.blockedReason || '' });
  req.db = db; req.moderatorKey = key;
  next();
}

function requireNotIpBanned(req, res, next) {
  const db = readDb(); cleanup(db);
  const ip = getClientIp(req);
  const ban = db.ipBans.find((b) => b.ip === ip && b.active);
  const allow = ['/06adm', '/mdr', '/ban', '/api/admin/login', '/api/moderator/login'];
  if (ban && !allow.includes(req.path)) {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'ip_banned', reason: ban.reason });
    return res.redirect('/ban');
  }
  req.db = db; req.clientIp = ip;
  next();
}

app.use(requireNotIpBanned);

['/', '/login', '/tape', '/profile', '/search'].forEach((r) => {
  app.get(r, (_, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
});

app.get('/ban', (req, res) => {
  const ban = req.db.ipBans.find((b) => b.ip === req.clientIp && b.active);
  res.send(shellPage('VP Ban', `<div class="main"><div class="card"><h1>Доступ к VP был ограничен</h1><p>${ban?.reason || 'Причина не указана'}</p></div></div>`));
});

app.get('/06adm', (_, res) => {
  res.send(shellPage('VP Admin Login', `<div class="main"><div class="card" style="max-width:420px;margin:40px auto"><h2>Вход в админ панель</h2><form method="post" action="/api/admin/login"><input type="password" name="password" placeholder="Пароль" required><br><br><button>Войти</button></form></div></div>`));
});

app.get('/mdr', (_, res) => {
  res.send(shellPage('VP Moderator Login', `<div class="main"><div class="card" style="max-width:420px;margin:40px auto"><h2>Вход в панель модератора</h2><form method="post" action="/api/moderator/login"><input name="code" placeholder="Ключ доступа" required><br><br><button>Войти</button></form></div></div>`));
});

app.get('/admin', adminAuth, (req, res) => res.send(adminPage(req.db)));
app.get('/moderator', moderatorAuth, (_, res) => res.send(moderatorPage()));

app.post('/api/auth/register', (req, res) => {
  const db = req.db;
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (username.length < 5) return res.status(400).json({ error: 'username_min_5' });
  if (password.length < 6) return res.status(400).json({ error: 'password_min_6' });
  if (db.users.some((u) => u.username === username)) return res.status(409).json({ error: 'user_exists' });
  const user = { id: id('usr'), username, passwordHash: hash(password), displayName: req.body.displayName || username, bio: '', avatarUrl: '', bannerUrl: '', bannedUntil: null, bannedReason: '', createdAt: now() };
  db.users.push(user); writeDb(db);
  res.json({ ok: true, userId: user.id });
});

app.post('/api/auth/login', (req, res) => {
  const db = req.db; cleanup(db);
  const username = String(req.body.username || '').trim().toLowerCase();
  const user = db.users.find((u) => u.username === username);
  if (!user || user.passwordHash !== hash(String(req.body.password || ''))) return res.status(401).json({ error: 'invalid_credentials' });
  if (user.bannedUntil && user.bannedUntil > now()) return res.status(403).json({ error: 'temporarily_banned', reason: user.bannedReason, bannedUntil: user.bannedUntil });
  const token = id('sess');
  db.sessions.push({ token, userId: user.id, createdAt: now(), expiresAt: now() + 30 * DAY_MS });
  writeDb(db);
  res.cookie('vp_session', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true, user: { id: user.id, username: user.username, displayName: user.displayName, bio: user.bio, avatarUrl: user.avatarUrl, bannerUrl: user.bannerUrl } });
});

app.post('/api/auth/logout', auth, (req, res) => {
  req.db.sessions = req.db.sessions.filter((s) => s.token !== req.session.token);
  writeDb(req.db);
  res.clearCookie('vp_session');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, displayName: req.user.displayName, bio: req.user.bio, avatarUrl: req.user.avatarUrl, bannerUrl: req.user.bannerUrl } });
});

app.patch('/api/me/profile', auth, (req, res) => {
  const username = req.body.username ? String(req.body.username).trim().toLowerCase() : req.user.username;
  if (username.length < 5) return res.status(400).json({ error: 'username_min_5' });
  if (req.db.users.some((u) => u.username === username && u.id !== req.user.id)) return res.status(409).json({ error: 'username_taken' });
  req.user.username = username;
  if (typeof req.body.displayName === 'string') req.user.displayName = req.body.displayName;
  if (typeof req.body.bio === 'string') req.user.bio = req.body.bio;
  if (typeof req.body.avatarUrl === 'string') req.user.avatarUrl = req.body.avatarUrl;
  if (typeof req.body.bannerUrl === 'string') req.user.bannerUrl = req.body.bannerUrl;
  writeDb(req.db);
  res.json({ ok: true, user: req.user });
});

app.post('/api/follows/:targetUserId', auth, (req, res) => {
  const targetId = req.params.targetUserId;
  if (targetId === req.user.id) return res.status(400).json({ error: 'cannot_follow_self' });
  if (!req.db.users.find((u) => u.id === targetId)) return res.status(404).json({ error: 'user_not_found' });
  if (!req.db.follows.find((f) => f.followerId === req.user.id && f.followingId === targetId)) {
    req.db.follows.push({ id: id('flw'), followerId: req.user.id, followingId: targetId, createdAt: now() });
  }
  writeDb(req.db); res.json({ ok: true });
});
app.delete('/api/follows/:targetUserId', auth, (req, res) => {
  req.db.follows = req.db.follows.filter((f) => !(f.followerId === req.user.id && f.followingId === req.params.targetUserId));
  writeDb(req.db); res.json({ ok: true });
});

app.get('/api/feed', auth, (req, res) => {
  cleanup(req.db);
  const followed = new Set(req.db.follows.filter((f) => f.followerId === req.user.id).map((f) => f.followingId));
  const items = req.db.posts.filter((p) => !p.deletedAt).sort((a, b) => b.createdAt - a.createdAt);
  const stories = req.db.stories.filter((s) => s.authorId === req.user.id || followed.has(s.authorId)).sort((a, b) => b.createdAt - a.createdAt);
  writeDb(req.db);
  res.json({ items, stories });
});

app.post('/api/posts', auth, (req, res) => {
  const post = { id: id('pst'), authorId: req.user.id, text: String(req.body.text || ''), media: Array.isArray(req.body.media) ? req.body.media : [], likes: 0, reposts: 0, createdAt: now(), deletedAt: null, deletedBy: null, restoreUntil: null };
  req.db.posts.push(post); writeDb(req.db);
  res.json({ ok: true, post });
});

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const post = req.db.posts.find((p) => p.id === req.params.id && !p.deletedAt);
  if (!post) return res.status(404).json({ error: 'post_not_found' });
  const comment = { id: id('cmt'), postId: post.id, authorId: req.user.id, text: String(req.body.text || ''), createdAt: now(), deletedAt: null, deletedBy: null, restoreUntil: null };
  req.db.comments.push(comment); writeDb(req.db);
  res.json({ ok: true, comment });
});

app.post('/api/stories', auth, (req, res) => {
  const story = { id: id('sty'), authorId: req.user.id, mediaUrl: String(req.body.mediaUrl || ''), text: String(req.body.text || ''), createdAt: now(), expiresAt: now() + DAY_MS, deletedAt: null };
  req.db.stories.push(story); writeDb(req.db);
  res.json({ ok: true, story });
});
app.get('/api/stories', auth, (req, res) => {
  cleanup(req.db);
  const followed = new Set(req.db.follows.filter((f) => f.followerId === req.user.id).map((f) => f.followingId));
  const items = req.db.stories.filter((s) => s.authorId === req.user.id || followed.has(s.authorId));
  writeDb(req.db); res.json({ items });
});

app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).send('invalid_password');
  const db = readDb();
  const token = id('adm');
  db.adminSessions.push({ token, createdAt: now(), expiresAt: now() + 30 * DAY_MS });
  writeDb(db);
  res.cookie('vp_admin_session', token, { httpOnly: true, sameSite: 'lax' });
  if ((req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) return res.redirect('/admin');
  res.json({ ok: true });
});

app.post('/api/moderator/login', (req, res) => {
  const db = readDb();
  const key = db.moderatorKeys.find((k) => k.code === String(req.body.code || '').trim().toUpperCase());
  if (!key) return res.status(401).send('invalid_code');
  if (key.blocked) return res.status(403).send('key_blocked');
  const token = id('mdr');
  db.moderatorSessions.push({ token, keyId: key.id, ip: getClientIp(req), createdAt: now(), expiresAt: now() + 30 * DAY_MS });
  writeDb(db);
  res.cookie('vp_mdr_session', token, { httpOnly: true, sameSite: 'lax' });
  if ((req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) return res.redirect('/moderator');
  res.json({ ok: true });
});

function softDeletePost(db, postId, actor) {
  const p = db.posts.find((x) => x.id === postId && !x.deletedAt);
  if (!p) return false;
  p.deletedAt = now(); p.deletedBy = actor; p.restoreUntil = p.deletedAt + DAY_MS;
  return true;
}
function restorePost(db, postId) {
  const p = db.posts.find((x) => x.id === postId && x.deletedAt && x.restoreUntil > now());
  if (!p) return false;
  p.deletedAt = null; p.deletedBy = null; p.restoreUntil = null;
  return true;
}
function softDeleteComment(db, commentId, actor) {
  const c = db.comments.find((x) => x.id === commentId && !x.deletedAt);
  if (!c) return false;
  c.deletedAt = now(); c.deletedBy = actor; c.restoreUntil = c.deletedAt + DAY_MS;
  return true;
}
function restoreComment(db, commentId) {
  const c = db.comments.find((x) => x.id === commentId && x.deletedAt && x.restoreUntil > now());
  if (!c) return false;
  c.deletedAt = null; c.deletedBy = null; c.restoreUntil = null;
  return true;
}

app.get('/api/admin/posts', adminAuth, (req, res) => {
  const includeDeleted = req.query.includeDeleted === '1';
  const items = req.db.posts.filter((p) => includeDeleted || !p.deletedAt).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ items });
});
app.get('/api/admin/comments', adminAuth, (req, res) => {
  const includeDeleted = req.query.includeDeleted === '1';
  const items = req.db.comments.filter((c) => includeDeleted || !c.deletedAt).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ items });
});
app.get('/api/admin/users', adminAuth, (req, res) => {
  const items = req.db.users.map((u) => ({ id: u.id, username: u.username, displayName: u.displayName, bannedUntil: u.bannedUntil, bannedReason: u.bannedReason }));
  res.json({ items });
});
app.get('/api/admin/keys', adminAuth, (req, res) => res.json({ items: req.db.moderatorKeys }));
app.get('/api/admin/ip-bans', adminAuth, (req, res) => res.json({ items: req.db.ipBans }));

app.post('/api/admin/posts/:id/delete', adminAuth, (req, res) => {
  if (!softDeletePost(req.db, req.params.id, 'admin')) return res.status(404).json({ error: 'post_not_found' });
  writeDb(req.db); res.json({ ok: true });
});
app.post('/api/admin/posts/:id/restore', adminAuth, (req, res) => {
  if (!restorePost(req.db, req.params.id)) return res.status(404).json({ error: 'not_restorable' });
  writeDb(req.db); res.json({ ok: true });
});
app.post('/api/admin/comments/:id/delete', adminAuth, (req, res) => {
  if (!softDeleteComment(req.db, req.params.id, 'admin')) return res.status(404).json({ error: 'comment_not_found' });
  writeDb(req.db); res.json({ ok: true });
});
app.post('/api/admin/comments/:id/restore', adminAuth, (req, res) => {
  if (!restoreComment(req.db, req.params.id)) return res.status(404).json({ error: 'not_restorable' });
  writeDb(req.db); res.json({ ok: true });
});
app.post('/api/admin/users/:id/ban', adminAuth, (req, res) => {
  const user = req.db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  const durationMs = Number(req.body.durationMs || DAY_MS);
  user.bannedUntil = now() + (durationMs > 0 ? durationMs : DAY_MS);
  user.bannedReason = String(req.body.reason || 'Нарушение правил');
  req.db.sessions = req.db.sessions.filter((s) => s.userId !== user.id);
  writeDb(req.db); res.json({ ok: true });
});
app.post('/api/admin/users/:id/unban', adminAuth, (req, res) => {
  const user = req.db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  user.bannedUntil = null; user.bannedReason = '';
  writeDb(req.db); res.json({ ok: true });
});
app.post('/api/admin/ip-ban', adminAuth, (req, res) => {
  const ip = String(req.body.ip || '').trim();
  if (!ip) return res.status(400).json({ error: 'ip_required' });
  const reason = String(req.body.reason || 'Нарушение правил');
  const e = req.db.ipBans.find((b) => b.ip === ip);
  if (e) { e.active = true; e.reason = reason; e.updatedAt = now(); }
  else req.db.ipBans.push({ id: id('ipban'), ip, reason, active: true, createdAt: now(), updatedAt: now() });
  writeDb(req.db); res.json({ ok: true });
});
app.post('/api/admin/ip-ban/:id/disable', adminAuth, (req, res) => {
  const b = req.db.ipBans.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'ban_not_found' });
  b.active = false; b.updatedAt = now();
  writeDb(req.db); res.json({ ok: true });
});
app.post('/api/admin/keys', adminAuth, (req, res) => {
  const key = { id: id('key'), name: String(req.body.name || 'Moderator'), code: crypto.randomBytes(5).toString('hex').toUpperCase(), blocked: false, blockedReason: '', createdAt: now() };
  req.db.moderatorKeys.push(key); writeDb(req.db);
  res.json({ ok: true, key });
});
app.post('/api/admin/keys/:id/block', adminAuth, (req, res) => {
  const key = req.db.moderatorKeys.find((k) => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: 'key_not_found' });
  key.blocked = true;
  key.blockedReason = String(req.body.reason || 'Доступ ограничен');
  const sessionsForKey = req.db.moderatorSessions.filter((s) => s.keyId === key.id);
  sessionsForKey.forEach((s) => {
    if (s.ip) {
      const existing = req.db.ipBans.find((b) => b.ip === s.ip);
      if (existing) { existing.active = true; existing.reason = key.blockedReason; existing.updatedAt = now(); }
      else req.db.ipBans.push({ id: id('ipban'), ip: s.ip, reason: key.blockedReason, active: true, createdAt: now(), updatedAt: now() });
    }
  });
  req.db.moderatorSessions = req.db.moderatorSessions.filter((s) => s.keyId !== key.id);
  writeDb(req.db); res.json({ ok: true });
});
app.delete('/api/admin/keys/:id', adminAuth, (req, res) => {
  req.db.moderatorKeys = req.db.moderatorKeys.filter((k) => k.id !== req.params.id);
  req.db.moderatorSessions = req.db.moderatorSessions.filter((s) => s.keyId !== req.params.id);
  writeDb(req.db); res.json({ ok: true });
});

app.get('/api/moderator/posts', moderatorAuth, (req, res) => {
  const includeDeleted = req.query.includeDeleted === '1';
  res.json({ items: req.db.posts.filter((p) => includeDeleted || !p.deletedAt).sort((a, b) => b.createdAt - a.createdAt) });
});
app.post('/api/moderator/posts/:id/delete', moderatorAuth, (req, res) => {
  if (!softDeletePost(req.db, req.params.id, `moderator:${req.moderatorKey.name}`)) return res.status(404).json({ error: 'post_not_found' });
  writeDb(req.db); res.json({ ok: true });
});
app.get('/api/moderator/comments', moderatorAuth, (req, res) => {
  const includeDeleted = req.query.includeDeleted === '1';
  res.json({ items: req.db.comments.filter((c) => includeDeleted || !c.deletedAt).sort((a, b) => b.createdAt - a.createdAt) });
});
app.post('/api/moderator/comments/:id/delete', moderatorAuth, (req, res) => {
  if (!softDeleteComment(req.db, req.params.id, `moderator:${req.moderatorKey.name}`)) return res.status(404).json({ error: 'comment_not_found' });
  writeDb(req.db); res.json({ ok: true });
});
app.get('/api/moderator/users', moderatorAuth, (req, res) => {
  res.json({ items: req.db.users.map((u) => ({ id: u.id, username: u.username, bannedUntil: u.bannedUntil, bannedReason: u.bannedReason })) });
});
app.post('/api/moderator/users/:id/ban', moderatorAuth, (req, res) => {
  const user = req.db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  user.bannedUntil = now() + Number(req.body.durationMs || DAY_MS);
  user.bannedReason = String(req.body.reason || `Модератор ${req.moderatorKey.name}`);
  req.db.sessions = req.db.sessions.filter((s) => s.userId !== user.id);
  writeDb(req.db); res.json({ ok: true });
});
app.post('/api/moderator/users/:id/unban', moderatorAuth, (req, res) => {
  const user = req.db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  user.bannedUntil = null; user.bannedReason = '';
  writeDb(req.db); res.json({ ok: true });
});

app.get('/health', (_, res) => res.json({ ok: true, ts: now() }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  return res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, () => console.log(`VP backend running on port ${PORT}`));

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

function now() { return Date.now(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }

function defaultDb() {
  return {
    users: [],
    posts: [],
    comments: [],
    stories: [],
    follows: [],
    sessions: [],
    adminSessions: [],
    moderatorSessions: [],
    moderatorKeys: [],
    ipBans: []
  };
}

function ensureDbShape(db) {
  const d = defaultDb();
  Object.keys(d).forEach((k) => {
    if (!Array.isArray(db[k])) db[k] = d[k];
  });
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

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getClientIp(req) {
  const raw = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  return raw.split(',')[0].trim();
}

function findSession(db, token) {
  if (!token) return null;
  return db.sessions.find((s) => s.token === token && s.expiresAt > now()) || null;
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

function basePage(title, body) {
  return `<!doctype html><html lang="ru"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><style>
  body{margin:0;background:#080a10;color:#eef2ff;font-family:Inter,system-ui,sans-serif}
  .wrap{max-width:900px;margin:0 auto;padding:18px}
  .card{background:#101827;border:1px solid #1f2937;border-radius:14px;padding:16px;margin:10px 0}
  input,button,textarea,select{width:100%;padding:10px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#fff;box-sizing:border-box}
  button{background:#2563eb;border-color:#2563eb;font-weight:700;cursor:pointer}
  h1,h2{margin:0 0 10px} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .small{font-size:12px;color:#94a3b8} .ok{color:#22c55e} .err{color:#f87171}
  </style></head><body>${body}</body></html>`;
}

function auth(req, res, next) {
  const db = readDb();
  cleanup(db);
  const session = findSession(db, req.cookies.vp_session);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return res.status(401).json({ error: 'user_not_found' });
  req.db = db;
  req.user = user;
  req.session = session;
  next();
}

function adminAuth(req, res, next) {
  const db = readDb();
  cleanup(db);
  const token = req.cookies.vp_admin_session;
  const ok = db.adminSessions.find((s) => s.token === token && s.expiresAt > now());
  if (!ok) return res.status(401).json({ error: 'admin_unauthorized' });
  req.db = db;
  next();
}

function moderatorAuth(req, res, next) {
  const db = readDb();
  cleanup(db);
  const token = req.cookies.vp_mdr_session;
  const s = db.moderatorSessions.find((x) => x.token === token && x.expiresAt > now());
  if (!s) return res.status(401).json({ error: 'moderator_unauthorized' });
  const key = db.moderatorKeys.find((k) => k.id === s.keyId);
  if (!key || key.blocked) return res.status(403).json({ error: 'key_blocked', reason: key?.blockedReason || '' });
  req.db = db;
  req.moderatorKey = key;
  next();
}

function requireNotIpBanned(req, res, next) {
  const db = readDb();
  cleanup(db);
  const ip = getClientIp(req);
  const ban = db.ipBans.find((b) => b.ip === ip && b.active);
  const allow = ['/06adm', '/mdr', '/ban', '/api/admin/login', '/api/moderator/login'];
  if (ban && !allow.includes(req.path)) {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'ip_banned', reason: ban.reason });
    return res.redirect('/ban');
  }
  req.db = db;
  req.clientIp = ip;
  next();
}

app.use(requireNotIpBanned);

// App routes for Render + SPA fallback
['/', '/login', '/tape', '/profile', '/search'].forEach((r) => {
  app.get(r, (_, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
});

app.get('/ban', (req, res) => {
  const ban = req.db.ipBans.find((b) => b.ip === req.clientIp && b.active);
  res.send(basePage('VP - Ban', `<div class="wrap"><div class="card"><h1>Доступ к VP был ограничен</h1><p>${ban?.reason || 'Причина не указана'}</p></div></div>`));
});

app.get('/06adm', (_, res) => {
  res.send(basePage('VP Admin Login', `<div class="wrap"><div class="card"><h1>Вход в админ панель</h1><form method="post" action="/api/admin/login"><input type="password" name="password" placeholder="Пароль" required/><br/><br/><button type="submit">Войти</button></form><p class="small">Маршрут: /06adm</p></div></div>`));
});

app.get('/mdr', (_, res) => {
  res.send(basePage('VP Moderator Login', `<div class="wrap"><div class="card"><h1>Вход в панель модератора</h1><form method="post" action="/api/moderator/login"><input name="code" placeholder="Ключ доступа" required/><br/><br/><button type="submit">Войти</button></form><p class="small">Маршрут: /mdr</p></div></div>`));
});

app.get('/admin', adminAuth, (req, res) => {
  const users = req.db.users.length;
  const posts = req.db.posts.filter((p) => !p.deletedAt).length;
  const comments = req.db.comments.filter((c) => !c.deletedAt).length;
  res.send(basePage('VP Admin', `<div class="wrap"><h1>Админ панель VP</h1><div class="grid"><div class="card"><h2>Пользователи</h2><p>${users}</p></div><div class="card"><h2>Посты</h2><p>${posts}</p></div><div class="card"><h2>Комментарии</h2><p>${comments}</p></div></div><div class="card"><h2>Ключи модераторов</h2><p class="small">Создание/блокировка/удаление через API.</p></div></div>`));
});

app.get('/moderator', moderatorAuth, (req, res) => {
  res.send(basePage('VP Moderator', `<div class="wrap"><div class="card"><h1>Панель модератора</h1><p>Ключ: ${req.moderatorKey.name}</p><p class="small">Доступ: посты/комментарии/пользователи.</p></div></div>`));
});

app.post('/api/auth/register', (req, res) => {
  const db = req.db;
  const { username, password, displayName } = req.body;
  const uname = String(username || '').trim().toLowerCase();
  if (uname.length < 5) return res.status(400).json({ error: 'username_min_5' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'password_min_6' });
  if (db.users.some((u) => u.username === uname)) return res.status(409).json({ error: 'user_exists' });
  const user = {
    id: id('usr'), username: uname, passwordHash: hash(password), displayName: displayName || uname,
    bio: '', avatarUrl: '', bannerUrl: '', bannedUntil: null, bannedReason: '', createdAt: now()
  };
  db.users.push(user);
  writeDb(db);
  res.json({ ok: true, userId: user.id });
});

app.post('/api/auth/login', (req, res) => {
  const db = req.db;
  cleanup(db);
  const uname = String(req.body.username || '').trim().toLowerCase();
  const user = db.users.find((u) => u.username === uname);
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
  const conflict = req.db.users.find((u) => u.username === username && u.id !== req.user.id);
  if (conflict) return res.status(409).json({ error: 'username_taken' });
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
  if (!req.db.users.find((u) => u.id === targetId)) return res.status(404).json({ error: 'user_not_found' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'cannot_follow_self' });
  const existing = req.db.follows.find((f) => f.followerId === req.user.id && f.followingId === targetId);
  if (!existing) req.db.follows.push({ id: id('flw'), followerId: req.user.id, followingId: targetId, createdAt: now() });
  writeDb(req.db);
  res.json({ ok: true });
});

app.delete('/api/follows/:targetUserId', auth, (req, res) => {
  req.db.follows = req.db.follows.filter((f) => !(f.followerId === req.user.id && f.followingId === req.params.targetUserId));
  writeDb(req.db);
  res.json({ ok: true });
});

app.get('/api/feed', auth, (req, res) => {
  cleanup(req.db);
  const visiblePosts = req.db.posts.filter((p) => !p.deletedAt).sort((a, b) => b.createdAt - a.createdAt);
  const followedIds = new Set(req.db.follows.filter((f) => f.followerId === req.user.id).map((f) => f.followingId));
  const stories = req.db.stories.filter((s) => s.authorId === req.user.id || followedIds.has(s.authorId)).sort((a, b) => b.createdAt - a.createdAt);
  writeDb(req.db);
  res.json({ items: visiblePosts, stories });
});

app.post('/api/posts', auth, (req, res) => {
  const post = { id: id('pst'), authorId: req.user.id, text: String(req.body.text || ''), media: Array.isArray(req.body.media) ? req.body.media : [], likes: 0, reposts: 0, createdAt: now(), deletedAt: null, deletedBy: null, restoreUntil: null };
  req.db.posts.push(post);
  writeDb(req.db);
  res.json({ ok: true, post });
});

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const post = req.db.posts.find((p) => p.id === req.params.id && !p.deletedAt);
  if (!post) return res.status(404).json({ error: 'post_not_found' });
  const c = { id: id('cmt'), postId: post.id, authorId: req.user.id, text: String(req.body.text || ''), createdAt: now(), deletedAt: null, deletedBy: null, restoreUntil: null };
  req.db.comments.push(c);
  writeDb(req.db);
  res.json({ ok: true, comment: c });
});

app.post('/api/stories', auth, (req, res) => {
  const story = { id: id('sty'), authorId: req.user.id, mediaUrl: String(req.body.mediaUrl || ''), text: String(req.body.text || ''), createdAt: now(), expiresAt: now() + DAY_MS, deletedAt: null };
  req.db.stories.push(story);
  writeDb(req.db);
  res.json({ ok: true, story });
});

app.get('/api/stories', auth, (req, res) => {
  cleanup(req.db);
  const followedIds = new Set(req.db.follows.filter((f) => f.followerId === req.user.id).map((f) => f.followingId));
  const stories = req.db.stories.filter((s) => s.authorId === req.user.id || followedIds.has(s.authorId));
  writeDb(req.db);
  res.json({ items: stories });
});

app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'invalid_password' });
  const db = readDb();
  const token = id('adm');
  db.adminSessions.push({ token, createdAt: now(), expiresAt: now() + 30 * DAY_MS });
  writeDb(db);
  res.cookie('vp_admin_session', token, { httpOnly: true, sameSite: 'lax' });
  if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) return res.redirect('/admin');
  res.json({ ok: true });
});

app.post('/api/admin/keys', adminAuth, (req, res) => {
  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  const key = { id: id('key'), name: req.body.name || 'Moderator', code, blocked: false, blockedReason: '', createdAt: now() };
  req.db.moderatorKeys.push(key);
  writeDb(req.db);
  res.json({ ok: true, key });
});

app.post('/api/moderator/login', (req, res) => {
  const db = readDb();
  const key = db.moderatorKeys.find((k) => k.code === String(req.body.code || '').trim().toUpperCase());
  if (!key) return res.status(401).json({ error: 'invalid_code' });
  if (key.blocked) return res.status(403).json({ error: 'key_blocked', reason: key.blockedReason });
  const token = id('mdr');
  db.moderatorSessions.push({ token, keyId: key.id, createdAt: now(), expiresAt: now() + 30 * DAY_MS });
  writeDb(db);
  res.cookie('vp_mdr_session', token, { httpOnly: true, sameSite: 'lax' });
  if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) return res.redirect('/moderator');
  res.json({ ok: true });
});

function softDeletePost(db, postId, actor) {
  const p = db.posts.find((x) => x.id === postId && !x.deletedAt);
  if (!p) return false;
  p.deletedAt = now(); p.deletedBy = actor; p.restoreUntil = p.deletedAt + DAY_MS;
  return true;
}

function softDeleteComment(db, commentId, actor) {
  const c = db.comments.find((x) => x.id === commentId && !x.deletedAt);
  if (!c) return false;
  c.deletedAt = now(); c.deletedBy = actor; c.restoreUntil = c.deletedAt + DAY_MS;
  return true;
}

app.post('/api/admin/posts/:id/delete', adminAuth, (req, res) => {
  if (!softDeletePost(req.db, req.params.id, 'admin')) return res.status(404).json({ error: 'post_not_found' });
  writeDb(req.db); res.json({ ok: true });
});

app.post('/api/admin/posts/:id/restore', adminAuth, (req, res) => {
  const p = req.db.posts.find((x) => x.id === req.params.id && x.deletedAt && x.restoreUntil > now());
  if (!p) return res.status(404).json({ error: 'not_restorable' });
  p.deletedAt = null; p.deletedBy = null; p.restoreUntil = null;
  writeDb(req.db); res.json({ ok: true });
});

app.post('/api/moderator/posts/:id/delete', moderatorAuth, (req, res) => {
  if (!softDeletePost(req.db, req.params.id, `moderator:${req.moderatorKey.name}`)) return res.status(404).json({ error: 'post_not_found' });
  writeDb(req.db); res.json({ ok: true });
});

app.post('/api/admin/comments/:id/delete', adminAuth, (req, res) => {
  if (!softDeleteComment(req.db, req.params.id, 'admin')) return res.status(404).json({ error: 'comment_not_found' });
  writeDb(req.db); res.json({ ok: true });
});

app.post('/api/moderator/comments/:id/delete', moderatorAuth, (req, res) => {
  if (!softDeleteComment(req.db, req.params.id, `moderator:${req.moderatorKey.name}`)) return res.status(404).json({ error: 'comment_not_found' });
  writeDb(req.db); res.json({ ok: true });
});

app.post('/api/admin/users/:id/ban', adminAuth, (req, res) => {
  const user = req.db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  const durationMs = Number(req.body.durationMs || DAY_MS);
  user.bannedUntil = now() + (durationMs > 0 ? durationMs : DAY_MS);
  user.bannedReason = String(req.body.reason || 'Нарушение правил');
  req.db.sessions = req.db.sessions.filter((s) => s.userId !== user.id);
  writeDb(req.db);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/unban', adminAuth, (req, res) => {
  const user = req.db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  user.bannedUntil = null; user.bannedReason = '';
  writeDb(req.db);
  res.json({ ok: true });
});

app.post('/api/admin/ip-ban', adminAuth, (req, res) => {
  const { ip, reason = 'Нарушение правил' } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip_required' });
  const existing = req.db.ipBans.find((b) => b.ip === ip);
  if (existing) {
    existing.active = true; existing.reason = reason; existing.updatedAt = now();
  } else {
    req.db.ipBans.push({ id: id('ipban'), ip, reason, active: true, createdAt: now(), updatedAt: now() });
  }
  writeDb(req.db);
  res.json({ ok: true });
});

app.post('/api/admin/keys/:id/block', adminAuth, (req, res) => {
  const key = req.db.moderatorKeys.find((k) => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: 'key_not_found' });
  key.blocked = true;
  key.blockedReason = String(req.body.reason || 'Доступ ограничен');
  writeDb(req.db);
  res.json({ ok: true });
});

app.delete('/api/admin/keys/:id', adminAuth, (req, res) => {
  req.db.moderatorKeys = req.db.moderatorKeys.filter((k) => k.id !== req.params.id);
  req.db.moderatorSessions = req.db.moderatorSessions.filter((s) => s.keyId !== req.params.id);
  writeDb(req.db);
  res.json({ ok: true });
});

// Render health + fallback routing
app.get('/health', (_, res) => res.json({ ok: true, ts: now() }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  return res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`VP backend running on port ${PORT}`);
});

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const ADMIN_PASSWORD = 'allvadmp106';
const DAY_MS = 24 * 60 * 60 * 1000;

app.use(express.json({ limit: '10mb' }));
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
    sessions: [],
    adminSessions: [],
    moderatorSessions: [],
    moderatorKeys: [],
    ipBans: []
  };
}

function readDb() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDb(), null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
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
  return db.sessions.find(s => s.token === token && s.expiresAt > now()) || null;
}

function auth(req, res, next) {
  const db = readDb();
  const session = findSession(db, req.cookies.vp_session);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.db = db;
  req.user = db.users.find(u => u.id === session.userId) || null;
  req.session = session;
  if (!req.user) return res.status(401).json({ error: 'user_not_found' });
  next();
}

function adminAuth(req, res, next) {
  const db = readDb();
  const token = req.cookies.vp_admin_session;
  const ok = db.adminSessions.find(s => s.token === token && s.expiresAt > now());
  if (!ok) return res.status(401).json({ error: 'admin_unauthorized' });
  req.db = db;
  next();
}

function moderatorAuth(req, res, next) {
  const db = readDb();
  const token = req.cookies.vp_mdr_session;
  const s = db.moderatorSessions.find(x => x.token === token && x.expiresAt > now());
  if (!s) return res.status(401).json({ error: 'moderator_unauthorized' });
  const key = db.moderatorKeys.find(k => k.id === s.keyId);
  if (!key || key.blocked) return res.status(403).json({ error: 'key_blocked' });
  req.db = db;
  req.moderatorKey = key;
  next();
}

function requireNotIpBanned(req, res, next) {
  const db = readDb();
  const ip = getClientIp(req);
  const ban = db.ipBans.find(b => b.ip === ip && b.active);
  const allowPaths = ['/06adm', '/mdr', '/api/admin/login', '/api/moderator/login'];
  if (ban && !allowPaths.includes(req.path)) {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'ip_banned', reason: ban.reason });
    return res.redirect('/ban');
  }
  req.db = db;
  req.clientIp = ip;
  next();
}

app.use(requireNotIpBanned);

app.get('/login', (_, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/tape', (_, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/profile', (_, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/search', (_, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));

app.get('/ban', (req, res) => {
  const ban = req.db.ipBans.find(b => b.ip === req.clientIp && b.active);
  res.send(`<!doctype html><html><body style="background:#0b0b0d;color:#fff;font-family:sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;"><div><h1>Доступ к VP был ограничен</h1><p>${ban?.reason || 'Причина не указана'}</p></div></body></html>`);
});

app.get('/06adm', (_, res) => {
  res.send('<form method="post" action="/api/admin/login" style="margin:40px"><h2>Admin login</h2><input name="password" type="password"/><button>Войти</button></form>');
});
app.get('/mdr', (_, res) => {
  res.send('<form method="post" action="/api/moderator/login" style="margin:40px"><h2>Moderator login</h2><input name="code"/><button>Войти</button></form>');
});

app.use(express.urlencoded({ extended: true }));

app.post('/api/auth/register', (req, res) => {
  const db = req.db;
  const { username, password, displayName } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username_password_required' });
  if (db.users.some(u => u.username === username.toLowerCase())) return res.status(409).json({ error: 'user_exists' });
  const user = {
    id: id('usr'),
    username: username.toLowerCase(),
    passwordHash: hash(password),
    displayName: displayName || username,
    bio: '',
    avatarUrl: '',
    bannerUrl: '',
    bannedUntil: null,
    bannedReason: '',
    blocked: false,
    createdAt: now()
  };
  db.users.push(user);
  writeDb(db);
  res.json({ ok: true, userId: user.id });
});

app.post('/api/auth/login', (req, res) => {
  const db = req.db;
  const { username, password } = req.body;
  const user = db.users.find(u => u.username === String(username || '').toLowerCase());
  if (!user || user.passwordHash !== hash(String(password || ''))) return res.status(401).json({ error: 'invalid_credentials' });
  if (user.bannedUntil && user.bannedUntil > now()) {
    return res.status(403).json({ error: 'temporarily_banned', reason: user.bannedReason, bannedUntil: user.bannedUntil });
  }
  const token = id('sess');
  db.sessions.push({ token, userId: user.id, createdAt: now(), expiresAt: now() + 30 * DAY_MS });
  writeDb(db);
  res.cookie('vp_session', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true });
});

app.post('/api/auth/logout', auth, (req, res) => {
  req.db.sessions = req.db.sessions.filter(s => s.token !== req.session.token);
  writeDb(req.db);
  res.clearCookie('vp_session');
  res.json({ ok: true });
});

app.get('/api/feed', auth, (req, res) => {
  const visible = req.db.posts.filter(p => !p.deletedAt).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ items: visible });
});

app.post('/api/posts', auth, (req, res) => {
  const { text = '', media = [] } = req.body;
  const post = { id: id('pst'), authorId: req.user.id, text, media, likes: 0, reposts: 0, createdAt: now(), deletedAt: null, deletedBy: null };
  req.db.posts.push(post);
  writeDb(req.db);
  res.json({ ok: true, post });
});

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const post = req.db.posts.find(p => p.id === req.params.id && !p.deletedAt);
  if (!post) return res.status(404).json({ error: 'post_not_found' });
  const c = { id: id('cmt'), postId: post.id, authorId: req.user.id, text: String(req.body.text || ''), createdAt: now(), deletedAt: null, deletedBy: null };
  req.db.comments.push(c);
  writeDb(req.db);
  res.json({ ok: true, comment: c });
});

app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'invalid_password' });
  const db = readDb();
  const token = id('adm');
  db.adminSessions.push({ token, createdAt: now(), expiresAt: now() + 30 * DAY_MS });
  writeDb(db);
  res.cookie('vp_admin_session', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true });
});

app.post('/api/admin/keys', adminAuth, (req, res) => {
  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  const key = { id: id('key'), name: req.body.name || 'Moderator', code, blocked: false, blockedReason: '' };
  req.db.moderatorKeys.push(key);
  writeDb(req.db);
  res.json({ ok: true, key });
});

app.post('/api/moderator/login', (req, res) => {
  const db = readDb();
  const key = db.moderatorKeys.find(k => k.code === String(req.body.code || '').trim().toUpperCase());
  if (!key) return res.status(401).json({ error: 'invalid_code' });
  if (key.blocked) return res.status(403).json({ error: 'key_blocked', reason: key.blockedReason });
  const token = id('mdr');
  db.moderatorSessions.push({ token, keyId: key.id, createdAt: now(), expiresAt: now() + 30 * DAY_MS });
  writeDb(db);
  res.cookie('vp_mdr_session', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true });
});

function softDeletePost(db, id, actor) {
  const p = db.posts.find(x => x.id === id && !x.deletedAt);
  if (!p) return false;
  p.deletedAt = now();
  p.deletedBy = actor;
  p.restoreUntil = p.deletedAt + DAY_MS;
  return true;
}
function restorePost(db, id) {
  const p = db.posts.find(x => x.id === id && x.deletedAt && x.restoreUntil > now());
  if (!p) return false;
  p.deletedAt = null; p.deletedBy = null; p.restoreUntil = null;
  return true;
}

app.post('/api/admin/posts/:id/delete', adminAuth, (req, res) => {
  const ok = softDeletePost(req.db, req.params.id, 'admin');
  if (!ok) return res.status(404).json({ error: 'post_not_found' });
  writeDb(req.db);
  res.json({ ok: true });
});
app.post('/api/admin/posts/:id/restore', adminAuth, (req, res) => {
  const ok = restorePost(req.db, req.params.id);
  if (!ok) return res.status(404).json({ error: 'not_restorable' });
  writeDb(req.db);
  res.json({ ok: true });
});
app.post('/api/moderator/posts/:id/delete', moderatorAuth, (req, res) => {
  const ok = softDeletePost(req.db, req.params.id, `moderator:${req.moderatorKey.name}`);
  if (!ok) return res.status(404).json({ error: 'post_not_found' });
  writeDb(req.db);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/ban', adminAuth, (req, res) => {
  const user = req.db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  const durationMs = Number(req.body.durationMs || 0);
  user.bannedUntil = durationMs > 0 ? now() + durationMs : now() + DAY_MS;
  user.bannedReason = req.body.reason || 'Нарушение правил';
  req.db.sessions = req.db.sessions.filter(s => s.userId !== user.id);
  writeDb(req.db);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/unban', adminAuth, (req, res) => {
  const user = req.db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  user.bannedUntil = null; user.bannedReason = '';
  writeDb(req.db);
  res.json({ ok: true });
});

app.post('/api/admin/ip-ban', adminAuth, (req, res) => {
  const { ip, reason = 'Нарушение правил' } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip_required' });
  const current = req.db.ipBans.find(b => b.ip === ip);
  if (current) { current.active = true; current.reason = reason; current.updatedAt = now(); }
  else req.db.ipBans.push({ id: id('ipban'), ip, reason, active: true, createdAt: now(), updatedAt: now() });
  writeDb(req.db);
  res.json({ ok: true });
});

app.post('/api/admin/keys/:id/block', adminAuth, (req, res) => {
  const key = req.db.moderatorKeys.find(k => k.id === req.params.id);
  if (!key) return res.status(404).json({ error: 'key_not_found' });
  key.blocked = true;
  key.blockedReason = req.body.reason || 'Доступ ограничен';
  writeDb(req.db);
  res.json({ ok: true });
});

app.delete('/api/admin/keys/:id', adminAuth, (req, res) => {
  req.db.moderatorKeys = req.db.moderatorKeys.filter(k => k.id !== req.params.id);
  req.db.moderatorSessions = req.db.moderatorSessions.filter(s => s.keyId !== req.params.id);
  writeDb(req.db);
  res.json({ ok: true });
});

app.post('/api/admin/cleanup', adminAuth, (req, res) => {
  const before = req.db.posts.length;
  req.db.posts = req.db.posts.filter(p => !(p.deletedAt && p.restoreUntil && p.restoreUntil <= now()));
  const removed = before - req.db.posts.length;
  writeDb(req.db);
  res.json({ ok: true, removed });
});

app.listen(PORT, () => {
  console.log(`VP backend running on http://localhost:${PORT}`);
});

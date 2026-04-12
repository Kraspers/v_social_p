const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'vp_dev_secret_change_me';
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'db.json');
const VPSC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], posts: [], comments: [], likes: [], follows: [], stories: [], postViews: [] }, null, 2));
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  db.users ||= []; db.posts ||= []; db.comments ||= []; db.likes ||= []; db.follows ||= []; db.stories ||= []; db.commentLikes ||= []; db.postViews ||= [];
  db.users.forEach((u) => {
    if (typeof u.favoriteTrackName !== 'string') u.favoriteTrackName = '';
    if (typeof u.favoriteTrackUrl !== 'string') u.favoriteTrackUrl = '';
    if (!Array.isArray(u.favoriteTracks)) {
      u.favoriteTracks = (u.favoriteTrackUrl && u.favoriteTrackName) ? [{ name: String(u.favoriteTrackName).slice(0, 140), url: String(u.favoriteTrackUrl), coverUrl: '', createdAt: u.createdAt || nowIso() }] : [];
    }
  });
  if (!db.meta) db.meta = { postSeq: 1, commentSeq: 1, vpscAttempts: {} };
  if (!db.meta.vpscAttempts) db.meta.vpscAttempts = {};
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function readDb() { ensureDb(); return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
function writeDb(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomBytes(12).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const usernameRe = /^[a-zA-Z0-9_.]{5,24}$/;
const makeVpsc = () => Array.from({ length: 6 }, () => VPSC_ALPHABET[Math.floor(Math.random() * VPSC_ALPHABET.length)]).join('');
const makePostId = () => crypto.randomBytes(9).toString('base64url');
const viewStreamClients = new Set();

function broadcastViewUpdate(postId, views) {
  const payload = `event: view\ndata: ${JSON.stringify({ postId, views })}\n\n`;
  viewStreamClients.forEach((client) => {
    try { client.res.write(payload); } catch {}
  });
}

function gc(db) {
  const ttl = Date.now() - 24 * 60 * 60 * 1000;
  db.stories = db.stories.filter((s) => new Date(s.createdAt).getTime() >= ttl);
}

function signToken(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const good = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (good !== sig) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!data.exp || data.exp < Date.now()) return null;
  return data.sub;
}

function sendJson(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(data));
}
function parseBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2e7) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}
function authUser(req, db) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const userId = verifyToken(token);
  if (!userId) return null;
  return db.users.find((u) => u.id === userId) || null;
}
function authUserFromToken(token, db) {
  const userId = verifyToken(token);
  if (!userId) return null;
  return db.users.find((u) => u.id === userId) || null;
}
function sanitizeUser(u) {
  const { passwordHash, ...safe } = u;
  return safe;
}

function normalizeProfileImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  const cleaned = raw.replace(/\\/g, '/').replace(/^\.?\//, '');
  if (cleaned.startsWith('uploads/')) return `/${cleaned}`;
  if (cleaned.startsWith('/uploads/')) return cleaned;
  return raw;
}

function removeUploadedFileIfLocal(urlValue) {
  const normalized = normalizeProfileImageUrl(urlValue);
  if (!normalized || !normalized.startsWith('/uploads/')) return;
  const relativePath = normalized.slice(1);
  const filePath = path.join(ROOT, relativePath);
  if (!filePath.startsWith(path.join(ROOT, 'uploads'))) return;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
}

function relativeTime(iso) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const d = Math.max(0, now - t);
  const m = Math.floor(d / 60000);
  const h = Math.floor(d / 3600000);
  const day = Math.floor(d / 86400000);
  if (d < 60000) return 'Только что';
  if (m < 60) return `${m} мин`;
  if (h < 24) return `${h} ч`;
  if (day < 365) return `${day} д`;
  return new Date(iso).toLocaleDateString('ru-RU');
}

function countAllComments(db, postId) {
  return db.comments.filter((c) => samePostRef(c.postId, postId)).length;
}

function samePostRef(a, b) {
  return String(a) === String(b);
}

function resolvePostByIdentifier(db, identifierValue) {
  const identifier = String(identifierValue || '');
  let post = db.posts.find((p) => p.publicId === identifier);
  if (!post && /^vp_[a-z0-9]+$/i.test(identifier)) {
    const legacyId = Number.parseInt(identifier.slice(3), 36);
    if (Number.isFinite(legacyId)) post = db.posts.find((p) => samePostRef(p.id, legacyId));
  }
  if (!post) post = db.posts.find((p) => samePostRef(p.id, identifier));
  return post || null;
}

function countUniquePostViews(db, postId) {
  const viewers = new Set();
  db.postViews.forEach((v) => {
    if (samePostRef(v.postId, postId)) viewers.add(String(v.userId));
  });
  return viewers.size;
}

function postDto(db, post, viewerId) {
  const author = db.users.find((u) => u.id === post.authorId);
  const likes = db.likes.filter((l) => samePostRef(l.postId, post.id)).length;
  const comments = countAllComments(db, post.id);
  const reposts = db.posts.filter((p) => samePostRef(p.repostOf, post.id)).length;
  const views = countUniquePostViews(db, post.id);
  const source = post.repostOf ? db.posts.find((p) => samePostRef(p.id, post.repostOf)) : null;
  const sourceAuthor = source ? db.users.find((u) => u.id === source.authorId) : null;
  return {
    id: post.id,
    publicId: post.publicId || `vp_${post.id.toString(36)}`,
    text: post.text,
    media: post.media || [],
    author: author?.displayName || 'Удалённый пользователь',
    username: author ? `@${author.username}` : '@deleted',
    avatar: author?.avatar || 'U',
    avatarUrl: author?.avatarUrl || '',
    time: relativeTime(post.createdAt),
    createdAt: post.createdAt,
    likes,
    comments,
    reposts,
    views,
    liked: !!db.likes.find((l) => samePostRef(l.postId, post.id) && l.userId === viewerId),
    reposted: !!db.posts.find((p) => samePostRef(p.repostOf, post.id) && p.authorId === viewerId),
    isRepost: !!post.repostOf,
    repostOf: post.repostOf ? (source ? {
      id: source.id,
      publicId: source.publicId || `vp_${source.id.toString(36)}`,
      text: source.text,
      media: source.media || [],
      author: sourceAuthor?.displayName || 'Удалённый пользователь',
      username: sourceAuthor ? `@${sourceAuthor.username}` : '@deleted',
      avatar: sourceAuthor?.avatar || 'U',
      avatarUrl: sourceAuthor?.avatarUrl || '',
      time: relativeTime(source.createdAt)
    } : {
      id: post.repostOf,
      publicId: '',
      text: '',
      media: [],
      author: 'Удалённый пользователь',
      username: '@deleted',
      avatar: 'U',
      avatarUrl: '',
      time: ''
    }) : null
  };
}

function serveFile(res, pathname) {
  let f = pathname === '/' ? '/index.html' : pathname;
  if (pathname === '/privacy') f = '/privacy.html';
  if (pathname === '/terms') f = '/terms.html';
  if (pathname === '/login' || pathname === '/tape' || /^\/post\/[a-zA-Z0-9_-]+$/.test(pathname)) f = '/index.html';
  const fp = path.join(ROOT, decodeURIComponent(f));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return false;
  const ext = path.extname(fp).toLowerCase();
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4'
  }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(fp).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const db = readDb();
  gc(db);

  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (u.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, ts: nowIso() });

  if (u.pathname === '/api/auth/register' && req.method === 'POST') {
    const b = await parseBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    const displayName = String(b.displayName || '').trim();

    if (!usernameRe.test(username)) return sendJson(res, 400, { error: 'Username: 5-24 символа (буквы, цифры, _ .)' });
    if (password.length < 4) return sendJson(res, 400, { error: 'Пароль минимум 4 символа' });
    if (!displayName || displayName.length > 60) return sendJson(res, 400, { error: 'Некорректное имя пользователя' });
    if (db.users.some((x) => x.username === username)) return sendJson(res, 409, { error: 'Username already exists' });

    let code = makeVpsc();
    while (db.users.some((x) => x.vpsc === code)) code = makeVpsc();

    const user = {
      id: uid(),
      username,
      displayName,
      passwordHash: sha(password),
      bio: '',
      avatar: (displayName[0] || 'U').toUpperCase(),
      avatarUrl: '',
      bannerUrl: '',
      favoriteTrackName: '',
      favoriteTrackUrl: '',
      favoriteTracks: [],
      vpsc: code,
      pinnedPostId: null,
      pinnedRepostId: null,
      createdAt: nowIso()
    };
    db.users.push(user);
    writeDb(db);
    return sendJson(res, 201, { token: signToken(user.id), user: sanitizeUser(user) });
  }

  if (u.pathname === '/api/auth/login' && req.method === 'POST') {
    const b = await parseBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    const user = db.users.find((x) => x.username === username);
    if (!user || user.passwordHash !== sha(password)) return sendJson(res, 401, { error: 'Invalid credentials' });
    return sendJson(res, 200, { token: signToken(user.id), user: sanitizeUser(user) });
  }

  if (u.pathname === '/api/auth/vpsc' && req.method === 'POST') {
    const b = await parseBody(req);
    const code = String(b.code || '').trim().toUpperCase();
    const ipKey = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const limit = db.meta.vpscAttempts[ipKey] || { fails: 0, blockedUntil: 0 };
    if (limit.blockedUntil && limit.blockedUntil > Date.now()) {
      return sendJson(res, 429, { error: 'Вход по VPSC временно заблокирован на 24 часа' });
    }
    const user = db.users.find((x) => x.vpsc === code);
    if (!user) {
      limit.fails = (limit.fails || 0) + 1;
      if (limit.fails >= 10) {
        limit.fails = 0;
        limit.blockedUntil = Date.now() + 24 * 60 * 60 * 1000;
      }
      db.meta.vpscAttempts[ipKey] = limit;
      writeDb(db);
      return sendJson(res, 401, { error: 'Неверный VPSC-код' });
    }
    db.meta.vpscAttempts[ipKey] = { fails: 0, blockedUntil: 0 };
    writeDb(db);
    return sendJson(res, 200, { token: signToken(user.id), user: sanitizeUser(user) });
  }

  if (u.pathname === '/api/views/stream' && req.method === 'GET') {
    const streamToken = String(u.searchParams.get('token') || '');
    const streamUser = authUserFromToken(streamToken, db);
    if (!streamUser) return sendJson(res, 401, { error: 'Unauthorized' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    const client = { res };
    viewStreamClients.add(client);
    res.write('event: ready\ndata: {"ok":true}\n\n');
    req.on('close', () => viewStreamClients.delete(client));
    return;
  }

  const me = authUser(req, db);

  if (u.pathname === '/api/me' && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const followers = db.follows.filter((f) => f.followingId === me.id).length;
    const following = db.follows.filter((f) => f.followerId === me.id).length;
    return sendJson(res, 200, { user: { ...sanitizeUser(me), followers, following } });
  }

  if (u.pathname === '/api/me' && req.method === 'PATCH') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const b = await parseBody(req);
    if (typeof b.displayName === 'string') {
      const display = b.displayName.trim();
      if (!display) return sendJson(res, 400, { error: 'Имя не может быть пустым' });
      if (display.length > 60) return sendJson(res, 400, { error: 'Имя слишком длинное' });
      me.displayName = display;
      me.avatar = (display[0] || 'U').toUpperCase();
    }
    if (typeof b.username === 'string') {
      const n = b.username.trim().toLowerCase().replace(/^@+/, '');
      if (!usernameRe.test(n)) return sendJson(res, 400, { error: 'Username: 5-24 символа (буквы, цифры, _ .)' });
      if (db.users.some((u2) => u2.username === n && u2.id !== me.id)) return sendJson(res, 409, { error: 'Username already exists' });
      me.username = n;
    }
    if (typeof b.bio === 'string') me.bio = b.bio.slice(0, 300);
    if (typeof b.avatarUrl === 'string') {
      const nextAvatarUrl = normalizeProfileImageUrl(b.avatarUrl);
      const prevAvatarUrl = normalizeProfileImageUrl(me.avatarUrl);
      if (prevAvatarUrl && prevAvatarUrl !== nextAvatarUrl) removeUploadedFileIfLocal(prevAvatarUrl);
      me.avatarUrl = nextAvatarUrl;
    }
    if (typeof b.bannerUrl === 'string') {
      const nextBannerUrl = normalizeProfileImageUrl(b.bannerUrl);
      const prevBannerUrl = normalizeProfileImageUrl(me.bannerUrl);
      if (prevBannerUrl && prevBannerUrl !== nextBannerUrl) removeUploadedFileIfLocal(prevBannerUrl);
      me.bannerUrl = nextBannerUrl;
    }
    if (!Array.isArray(me.favoriteTracks)) me.favoriteTracks = [];
    if (Array.isArray(b.favoriteTracks)) {
      if (b.favoriteTracks.length > 30) return sendJson(res, 400, { error: 'Можно добавить максимум 30 треков' });
      const nextTracks = b.favoriteTracks
        .map((t) => ({
          name: String(t?.name || '').slice(0, 140).trim(),
          url: String(t?.url || '').trim(),
          coverUrl: String(t?.coverUrl || '').trim(),
          createdAt: t?.createdAt || nowIso()
        }))
        .filter((t) => t.name && t.url)
        .slice(0, 30);
      const prevUrls = new Set(me.favoriteTracks.map((t) => String(t?.url || '')).filter(Boolean));
      const nextUrls = new Set(nextTracks.map((t) => t.url));
      prevUrls.forEach((u3) => { if (!nextUrls.has(u3) && u3.startsWith('/uploads/')) removeUploadedFileIfLocal(u3); });
      me.favoriteTracks = nextTracks;
      const lastTrack = me.favoriteTracks[me.favoriteTracks.length - 1] || null;
      me.favoriteTrackName = lastTrack?.name || '';
      me.favoriteTrackUrl = lastTrack?.url || '';
    } else {
      if (Object.prototype.hasOwnProperty.call(b, 'favoriteTrackName')) me.favoriteTrackName = String(b.favoriteTrackName || '').slice(0, 140);
      if (Object.prototype.hasOwnProperty.call(b, 'favoriteTrackUrl')) me.favoriteTrackUrl = String(b.favoriteTrackUrl || '');
      if (me.favoriteTrackName && me.favoriteTrackUrl && !me.favoriteTracks.find((t) => t.url === me.favoriteTrackUrl)) {
        if (me.favoriteTracks.length >= 30) return sendJson(res, 400, { error: 'Можно добавить максимум 30 треков' });
        me.favoriteTracks.push({ name: me.favoriteTrackName, url: me.favoriteTrackUrl, coverUrl: '', createdAt: nowIso() });
      }
    }
    if (Object.prototype.hasOwnProperty.call(b, 'pinnedPostId')) me.pinnedPostId = b.pinnedPostId || null;
    if (Object.prototype.hasOwnProperty.call(b, 'pinnedRepostId')) me.pinnedRepostId = b.pinnedRepostId || null;
    writeDb(db);
    return sendJson(res, 200, { user: sanitizeUser(me) });
  }

  if (u.pathname === '/api/me/password' && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const b = await parseBody(req);
    const oldPassword = String(b.oldPassword || '');
    const newPassword = String(b.newPassword || '');
    if (sha(oldPassword) !== me.passwordHash) return sendJson(res, 400, { error: 'Неверный старый пароль' });
    if (newPassword.length < 4) return sendJson(res, 400, { error: 'Новый пароль минимум 4 символа' });
    me.passwordHash = sha(newPassword);
    writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (u.pathname === '/api/me/delete' && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const b = await parseBody(req);
    const pw = String(b.password || '');
    if (sha(pw) !== me.passwordHash) return sendJson(res, 400, { error: 'Неверный пароль' });

    const userPostIds = new Set(db.posts.filter((p) => p.authorId === me.id).map((p) => p.id));
    db.posts = db.posts.filter((p) => p.authorId !== me.id && !userPostIds.has(p.repostOf));
    db.comments = db.comments.filter((c) => c.authorId !== me.id && !userPostIds.has(c.postId));
    db.likes = db.likes.filter((l) => l.userId !== me.id && !userPostIds.has(l.postId));
    db.follows = db.follows.filter((f) => f.followerId !== me.id && f.followingId !== me.id);
    db.stories = db.stories.filter((s) => s.authorId !== me.id);
    db.commentLikes = db.commentLikes.filter((l) => l.userId !== me.id && !db.comments.find((c) => c.id === l.commentId && c.authorId === me.id));
    db.users = db.users.filter((u2) => u2.id !== me.id);
    writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (u.pathname === '/api/posts' && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const posts = db.posts.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((p) => postDto(db, p, me.id));
    return sendJson(res, 200, { posts });
  }

  if (u.pathname === '/api/posts' && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const b = await parseBody(req);
    const text = String(b.text || '');
    const media = Array.isArray(b.media) ? b.media.slice(0, 5) : [];
    if (!text.trim() && media.length === 0) return sendJson(res, 400, { error: 'text or media required' });
    let publicId = makePostId();
    while (db.posts.some((p) => p.publicId === publicId)) publicId = makePostId();
    const post = { id: db.meta.postSeq++, publicId, authorId: me.id, text, media, repostOf: b.repostOf || null, createdAt: nowIso() };
    db.posts.push(post);
    writeDb(db);
    return sendJson(res, 201, { post: postDto(db, post, me.id) });
  }

  const mLike = u.pathname.match(/^\/api\/posts\/([^/]+)\/like$/);
  if (mLike && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const post = resolvePostByIdentifier(db, decodeURIComponent(mLike[1]));
    if (!post) return sendJson(res, 404, { error: 'Post not found' });
    const postId = post.id;
    const idx = db.likes.findIndex((l) => samePostRef(l.postId, postId) && l.userId === me.id);
    let liked = true;
    if (idx >= 0) { db.likes.splice(idx, 1); liked = false; }
    else db.likes.push({ id: uid(), postId, userId: me.id, createdAt: nowIso() });
    writeDb(db);
    return sendJson(res, 200, { liked, likes: db.likes.filter((l) => samePostRef(l.postId, postId)).length });
  }

  const mView = u.pathname.match(/^\/api\/posts\/([^/]+)\/view$/);
  if (mView && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const post = resolvePostByIdentifier(db, decodeURIComponent(mView[1]));
    if (!post) return sendJson(res, 404, { error: 'Post not found' });
    const postId = post.id;
    const alreadyViewed = db.postViews.find((v) => samePostRef(v.postId, postId) && v.userId === me.id);
    if (!alreadyViewed) {
      db.postViews.push({ id: uid(), postId, userId: me.id, createdAt: nowIso() });
      writeDb(db);
    }
    const views = countUniquePostViews(db, postId);
    broadcastViewUpdate(postId, views);
    return sendJson(res, 200, { views });
  }

  const mRepost = u.pathname.match(/^\/api\/posts\/([^/]+)\/repost$/);
  if (mRepost && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const original = resolvePostByIdentifier(db, decodeURIComponent(mRepost[1]));
    if (!original) return sendJson(res, 404, { error: 'Post not found' });
    const postId = original.id;
    const existingIdx = db.posts.findIndex((p) => p.authorId === me.id && samePostRef(p.repostOf, postId));
    let reposted;
    if (existingIdx >= 0) {
      const repostId = db.posts[existingIdx].id;
      db.posts.splice(existingIdx, 1);
      db.comments = db.comments.filter((c) => !samePostRef(c.postId, repostId));
      db.likes = db.likes.filter((l) => !samePostRef(l.postId, repostId));
      reposted = false;
    } else {
      let publicId = makePostId();
      while (db.posts.some((p) => p.publicId === publicId)) publicId = makePostId();
      db.posts.push({ id: db.meta.postSeq++, publicId, authorId: me.id, text: '', media: [], repostOf: postId, createdAt: nowIso() });
      reposted = true;
    }
    writeDb(db);
    return sendJson(res, 200, { reposted, reposts: db.posts.filter((p) => samePostRef(p.repostOf, postId)).length });
  }

  const mCom = u.pathname.match(/^\/api\/posts\/([^/]+)\/comments$/);
  if (mCom && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const post = resolvePostByIdentifier(db, decodeURIComponent(mCom[1]));
    if (!post) return sendJson(res, 404, { error: 'Post not found' });
    const postId = post.id;
    const comments = db.comments
      .filter((c) => samePostRef(c.postId, postId))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((c) => {
        const au = db.users.find((x) => x.id === c.authorId);
        const createdTs = new Date(c.createdAt).getTime();
        const canManage = !!me && c.authorId === me.id && (Date.now() - createdTs) <= 24 * 60 * 60 * 1000;
        return {
          id: c.id,
          postId: c.postId,
          parentId: c.parentId,
          author: au?.displayName || 'Удалённый пользователь',
          username: au ? `@${au.username}` : '@deleted',
          avatar: au?.avatar || 'U',
          avatarUrl: au?.avatarUrl || '',
          text: c.text,
          likes: db.commentLikes.filter((l) => l.commentId === c.id).length,
          liked: !!db.commentLikes.find((l) => l.commentId === c.id && l.userId === me.id),
          mine: !!me && c.authorId === me.id,
          canManage,
          createdAt: c.createdAt,
          replies: [],
          time: relativeTime(c.createdAt)
        };
      });
    return sendJson(res, 200, { comments });
  }
  if (mCom && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const post = resolvePostByIdentifier(db, decodeURIComponent(mCom[1]));
    if (!post) return sendJson(res, 404, { error: 'Post not found' });
    const postId = post.id;
    const b = await parseBody(req);
    const text = String(b.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'text required' });
    db.comments.push({ id: db.meta.commentSeq++, postId, parentId: b.parentId || null, authorId: me.id, text: text.slice(0, 2000), createdAt: nowIso() });
    writeDb(db);
    return sendJson(res, 201, { ok: true });
  }

  const mCommentLike = u.pathname.match(/^\/api\/comments\/(\d+)\/like$/);
  if (mCommentLike && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const commentId = Number(mCommentLike[1]);
    if (!db.comments.find((c) => c.id === commentId)) return sendJson(res, 404, { error: 'Comment not found' });
    const idx = db.commentLikes.findIndex((l) => l.commentId === commentId && l.userId === me.id);
    let liked = true;
    if (idx >= 0) { db.commentLikes.splice(idx, 1); liked = false; }
    else db.commentLikes.push({ id: uid(), commentId, userId: me.id, createdAt: nowIso() });
    writeDb(db);
    return sendJson(res, 200, { liked, likes: db.commentLikes.filter((l) => l.commentId === commentId).length });
  }

  const mCommentPatch = u.pathname.match(/^\/api\/comments\/(\d+)$/);
  if (mCommentPatch && req.method === 'PATCH') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const commentId = Number(mCommentPatch[1]);
    const comment = db.comments.find((c) => c.id === commentId);
    if (!comment || comment.authorId !== me.id) return sendJson(res, 404, { error: 'Comment not found' });
    if ((Date.now() - new Date(comment.createdAt).getTime()) > 24 * 60 * 60 * 1000) return sendJson(res, 403, { error: 'Срок редактирования истёк' });
    const b = await parseBody(req);
    const text = String(b.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'text required' });
    comment.text = text.slice(0, 2000);
    writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  const mCommentDel = u.pathname.match(/^\/api\/comments\/(\d+)$/);
  if (mCommentDel && req.method === 'DELETE') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const commentId = Number(mCommentDel[1]);
    const comment = db.comments.find((c) => c.id === commentId);
    if (!comment || comment.authorId !== me.id) return sendJson(res, 404, { error: 'Comment not found' });
    if ((Date.now() - new Date(comment.createdAt).getTime()) > 24 * 60 * 60 * 1000) return sendJson(res, 403, { error: 'Срок удаления истёк' });
    db.comments = db.comments.filter((c) => c.id !== commentId && c.parentId !== commentId);
    db.commentLikes = db.commentLikes.filter((l) => l.commentId !== commentId);
    writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  const mPostById = u.pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (mPostById && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const identifier = decodeURIComponent(String(mPostById[1] || ''));
    const post = resolvePostByIdentifier(db, identifier);
    if (!post) return sendJson(res, 404, { error: 'Post not found' });
    return sendJson(res, 200, { post: postDto(db, post, me.id) });
  }
  const mPatch = u.pathname.match(/^\/api\/posts\/(\d+)$/);
  if (mPatch && req.method === 'PATCH') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const id = Number(mPatch[1]);
    const post = db.posts.find((p) => p.id === id && p.authorId === me.id);
    if (!post) return sendJson(res, 404, { error: 'Post not found' });
    const b = await parseBody(req);
    const nextText = String(b.text || '');
    const nextMedia = Array.isArray(b.media) ? b.media.slice(0, 5) : [];
    if (!nextText.trim() && nextMedia.length === 0) return sendJson(res, 400, { error: 'text or media required' });
    post.text = nextText;
    post.media = nextMedia;
    writeDb(db);
    return sendJson(res, 200, { post: postDto(db, post, me.id) });
  }

  const mDel = u.pathname.match(/^\/api\/posts\/(\d+)$/);
  if (mDel && req.method === 'DELETE') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const id = Number(mDel[1]);
    const idx = db.posts.findIndex((p) => p.id === id && p.authorId === me.id);
    if (idx < 0) return sendJson(res, 404, { error: 'Post not found' });
    db.posts.splice(idx, 1);
    db.likes = db.likes.filter((l) => !samePostRef(l.postId, id));
    db.postViews = db.postViews.filter((v) => !samePostRef(v.postId, id));
    const removedComments = new Set(db.comments.filter((c) => samePostRef(c.postId, id)).map((c) => c.id));
    db.comments = db.comments.filter((c) => !samePostRef(c.postId, id));
    db.commentLikes = db.commentLikes.filter((l) => !removedComments.has(l.commentId));
    writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  const mUser = u.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (mUser && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const username = decodeURIComponent(mUser[1]).replace('@', '').toLowerCase();
    const user = db.users.find((x) => x.username === username);
    if (!user) return sendJson(res, 404, { error: 'User not found' });
    const followers = db.follows.filter((f) => f.followingId === user.id).length;
    const following = db.follows.filter((f) => f.followerId === user.id).length;
    const isFollowing = !!db.follows.find((f) => f.followerId === me.id && f.followingId === user.id);
    return sendJson(res, 200, { user: { ...sanitizeUser(user), followers, following, isFollowing } });
  }

  const mFollow = u.pathname.match(/^\/api\/users\/([^/]+)\/follow$/);
  if (mFollow && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const username = decodeURIComponent(mFollow[1]).replace('@', '').toLowerCase();
    const user = db.users.find((x) => x.username === username);
    if (!user) return sendJson(res, 404, { error: 'User not found' });
    if (user.id === me.id) return sendJson(res, 400, { error: 'Cannot follow yourself' });
    const idx = db.follows.findIndex((f) => f.followerId === me.id && f.followingId === user.id);
    let following = true;
    if (idx >= 0) { db.follows.splice(idx, 1); following = false; }
    else db.follows.push({ id: uid(), followerId: me.id, followingId: user.id, createdAt: nowIso() });
    writeDb(db);
    return sendJson(res, 200, { following });
  }

  if (u.pathname === '/api/feed' && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const followedIds = db.follows.filter((f) => f.followerId === me.id).map((f) => f.followingId);
    const allowed = new Set([me.id, ...followedIds]);
    const posts = db.posts.filter((p) => allowed.has(p.authorId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((p) => postDto(db, p, me.id));
    return sendJson(res, 200, { posts });
  }

  if (u.pathname === '/api/stories' && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const followedIds = db.follows.filter((f) => f.followerId === me.id).map((f) => f.followingId);
    const allowed = new Set([me.id, ...followedIds]);
    const stories = db.stories
      .filter((s) => allowed.has(s.authorId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((s) => {
        const au = db.users.find((u2) => u2.id === s.authorId);
        return {
          id: s.id,
          authorId: s.authorId,
          username: au ? `@${au.username}` : '@deleted',
          author: au?.displayName || 'Удалённый пользователь',
          avatar: au?.avatar || 'U',
          avatarUrl: au?.avatarUrl || '',
          mediaType: s.mediaType,
          src: s.src,
          caption: s.caption || '',
          createdAt: s.createdAt
        };
      });
    writeDb(db);
    return sendJson(res, 200, { stories });
  }

  if (u.pathname === '/api/stories' && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const b = await parseBody(req);
    const src = String(b.src || '');
    const mediaType = b.mediaType === 'video' ? 'video' : 'image';
    const caption = String(b.caption || '').slice(0, 280);
    if (!src) return sendJson(res, 400, { error: 'src required' });
    db.stories.push({ id: uid(), authorId: me.id, src, mediaType, caption, createdAt: nowIso() });
    writeDb(db);
    return sendJson(res, 201, { ok: true });
  }

  if (u.pathname === '/api/upload' && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const b = await parseBody(req);
    const dataUrl = String(b.dataUrl || '');
    const kind = b.kind === 'banner' ? 'banner' : 'avatar';
    const m = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
    if (!m) return sendJson(res, 400, { error: 'Неверный формат изображения' });
    const subtype = m[2].toLowerCase() === 'jpg' ? 'jpeg' : m[2].toLowerCase();
    const ext = subtype === 'jpeg' ? 'jpg' : subtype;
    const raw = Buffer.from(m[3], 'base64');
    const max = kind === 'banner' ? 8 * 1024 * 1024 : 5 * 1024 * 1024;
    if (raw.length > max) return sendJson(res, 400, { error: 'Файл слишком большой' });
    const uploadDir = path.join(ROOT, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filename = `${me.id}_${kind}_${Date.now()}_${uid().slice(0,6)}.${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), raw);
    return sendJson(res, 201, { url: `/uploads/${filename}` });
  }


  if (u.pathname === '/api/upload-track' && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    if (!Array.isArray(me.favoriteTracks)) me.favoriteTracks = [];
    if (me.favoriteTracks.length >= 30) return sendJson(res, 400, { error: 'Можно добавить максимум 30 треков' });
    const b = await parseBody(req);
    const dataUrl = String(b.dataUrl || '');
    const m = dataUrl.match(/^data:audio\/(mpeg|mp3|mp4|x-m4a);base64,(.+)$/i);
    if (!m) return sendJson(res, 400, { error: 'Можно загрузить только MP3 или M4A' });
    const subtype = String(m[1] || '').toLowerCase();
    const ext = (subtype === 'mp4' || subtype === 'x-m4a') ? 'm4a' : 'mp3';
    const raw = Buffer.from(m[2], 'base64');
    const max = 20 * 1024 * 1024;
    if (raw.length > max) return sendJson(res, 400, { error: 'Файл слишком большой' });
    const uploadDir = path.join(ROOT, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filename = `${me.id}_track_${Date.now()}_${uid().slice(0,6)}.${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), raw);
    return sendJson(res, 201, { url: `/uploads/${filename}` });
  }

  if (u.pathname === '/api/trends' && req.method === 'GET') {
    const map = new Map();
    db.posts.forEach((p) => {
      const tags = String(p.text || '').match(/#[\p{L}\p{N}_]+/gu) || [];
      tags.forEach((t) => map.set(t.toLowerCase(), (map.get(t.toLowerCase()) || 0) + 1));
    });
    const trends = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag, count]) => ({ tag, count }));
    return sendJson(res, 200, { trends });
  }

  if (u.pathname === '/api/search' && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const q = String(u.searchParams.get('q') || '').trim().toLowerCase().replace(/^@/, '');
    if (!q) return sendJson(res, 200, { users: [] });
    const users = db.users
      .filter((usr) => usr.username.toLowerCase().includes(q) || String(usr.displayName || '').toLowerCase().includes(q))
      .slice(0, 30)
      .map((usr) => ({
        username: `@${usr.username}`,
        displayname: usr.displayName || '',
        bio: usr.bio || '',
        avatar: usr.avatar || 'U',
        avatarUrl: usr.avatarUrl || ''
      }));
    return sendJson(res, 200, { users });
  }

  if (u.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
  if (!serveFile(res, u.pathname)) sendJson(res, 404, { error: 'Not found' });
});

ensureDb();
server.listen(PORT, () => console.log(`VP backend running on http://0.0.0.0:${PORT}`));

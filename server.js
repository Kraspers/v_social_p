const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'vp_dev_secret_change_me';
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'db.json');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], posts: [], comments: [], likes: [], follows: [] }, null, 2));
  }
}
function readDb() { ensureDb(); return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
function writeDb(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomBytes(12).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' });
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
function sanitizeUser(u) { const { passwordHash, ...safe } = u; return safe; }
function postDto(db, post, viewerId) {
  const author = db.users.find((u) => u.id === post.authorId);
  const likes = db.likes.filter((l) => l.postId === post.id).length;
  const comments = db.comments.filter((c) => c.postId === post.id).length;
  const reposts = db.posts.filter((p) => p.repostOf === post.id).length;
  return {
    id: post.id, text: post.text, media: post.media || [],
    author: author?.displayName || 'Удалённый пользователь',
    username: author ? `@${author.username}` : '@deleted',
    avatar: author?.avatar || 'U', avatarUrl: author?.avatarUrl || '',
    time: new Date(post.createdAt).toLocaleString('ru-RU'), createdAt: post.createdAt,
    likes, comments, reposts,
    liked: !!db.likes.find((l) => l.postId === post.id && l.userId === viewerId),
    reposted: false, isRepost: !!post.repostOf, repostOf: null
  };
}

function serveFile(res, pathname) {
  let f = pathname === '/' ? '/index.html' : pathname;
  const fp = path.join(ROOT, decodeURIComponent(f));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return false;
  const ext = path.extname(fp).toLowerCase();
  const type = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(fp).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const db = readDb();
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  if (u.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, ts: nowIso() });

  if (u.pathname === '/api/auth/register' && req.method === 'POST') {
    const b = await parseBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    const displayName = String(b.displayName || '').trim();
    if (!username || !password || !displayName) return sendJson(res, 400, { error: 'username, password, displayName required' });
    if (db.users.some((x) => x.username === username)) return sendJson(res, 409, { error: 'Username already exists' });
    const user = { id: uid(), username, displayName, passwordHash: sha(password), bio: '', avatar: (displayName[0] || 'U').toUpperCase(), avatarUrl: '', createdAt: nowIso() };
    db.users.push(user); writeDb(db);
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

  const me = authUser(req, db);

  if (u.pathname === '/api/me' && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    return sendJson(res, 200, { user: sanitizeUser(me) });
  }

  if (u.pathname === '/api/me' && req.method === 'PATCH') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const b = await parseBody(req);
    if (typeof b.displayName === 'string' && b.displayName.trim()) { me.displayName = b.displayName.trim(); me.avatar = me.displayName[0].toUpperCase(); }
    if (typeof b.bio === 'string') me.bio = b.bio.slice(0, 300);
    if (typeof b.avatarUrl === 'string') me.avatarUrl = b.avatarUrl;
    writeDb(db); return sendJson(res, 200, { user: sanitizeUser(me) });
  }

  if (u.pathname === '/api/posts' && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const posts = db.posts.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map((p)=>postDto(db,p,me.id));
    return sendJson(res, 200, { posts });
  }

  if (u.pathname === '/api/posts' && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const b = await parseBody(req);
    const text = String(b.text || '');
    const media = Array.isArray(b.media) ? b.media.slice(0,5) : [];
    if (!text.trim() && media.length === 0) return sendJson(res, 400, { error: 'text or media required' });
    const p = { id: Date.now(), authorId: me.id, text, media, repostOf: b.repostOf || null, createdAt: nowIso() };
    db.posts.push(p); writeDb(db);
    return sendJson(res, 201, { post: postDto(db, p, me.id) });
  }

  const mLike = u.pathname.match(/^\/api\/posts\/(\d+)\/like$/);
  if (mLike && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const postId = Number(mLike[1]);
    if (!db.posts.find((p) => p.id === postId)) return sendJson(res, 404, { error: 'Post not found' });
    const idx = db.likes.findIndex((l)=>l.postId===postId && l.userId===me.id);
    let liked=true;
    if(idx>=0){db.likes.splice(idx,1);liked=false;} else db.likes.push({id:uid(),postId,userId:me.id,createdAt:nowIso()});
    writeDb(db);
    return sendJson(res, 200, { liked, likes: db.likes.filter((l)=>l.postId===postId).length });
  }

  const mCom = u.pathname.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (mCom && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const postId = Number(mCom[1]);
    const comments = db.comments.filter((c)=>c.postId===postId).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).map((c)=>{
      const au = db.users.find((x)=>x.id===c.authorId);
      return { id:c.id, postId:c.postId, parentId:c.parentId, author:au?.displayName||'Удалённый пользователь', username:au?`@${au.username}`:'@deleted', avatar:au?.avatar||'U', text:c.text, likes:0, liked:false, replies:[], time:new Date(c.createdAt).toLocaleString('ru-RU') };
    });
    return sendJson(res, 200, { comments });
  }
  if (mCom && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const postId = Number(mCom[1]);
    const b = await parseBody(req);
    const text = String(b.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'text required' });
    if (!db.posts.find((p) => p.id === postId)) return sendJson(res, 404, { error: 'Post not found' });
    db.comments.push({ id: Date.now(), postId, parentId: b.parentId || null, authorId: me.id, text: text.slice(0,2000), createdAt: nowIso() });
    writeDb(db);
    return sendJson(res, 201, { ok: true });
  }

  const mDel = u.pathname.match(/^\/api\/posts\/(\d+)$/);
  if (mDel && req.method === 'DELETE') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const id = Number(mDel[1]);
    const idx = db.posts.findIndex((p)=>p.id===id && p.authorId===me.id);
    if (idx < 0) return sendJson(res, 404, { error:'Post not found' });
    db.posts.splice(idx, 1); db.likes = db.likes.filter((l)=>l.postId!==id); db.comments = db.comments.filter((c)=>c.postId!==id); writeDb(db);
    return sendJson(res, 200, { ok:true });
  }

  const mUser = u.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (mUser && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const username = decodeURIComponent(mUser[1]).replace('@','').toLowerCase();
    const user = db.users.find((x)=>x.username===username);
    if(!user) return sendJson(res,404,{error:'User not found'});
    const followers = db.follows.filter((f)=>f.followingId===user.id).length;
    const following = db.follows.filter((f)=>f.followerId===user.id).length;
    const isFollowing = !!db.follows.find((f)=>f.followerId===me.id && f.followingId===user.id);
    return sendJson(res,200,{user:{...sanitizeUser(user),followers,following,isFollowing}});
  }

  const mFollow = u.pathname.match(/^\/api\/users\/([^/]+)\/follow$/);
  if (mFollow && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const username = decodeURIComponent(mFollow[1]).replace('@','').toLowerCase();
    const user = db.users.find((x)=>x.username===username);
    if(!user) return sendJson(res,404,{error:'User not found'});
    if(user.id===me.id) return sendJson(res,400,{error:'Cannot follow yourself'});
    const idx = db.follows.findIndex((f)=>f.followerId===me.id && f.followingId===user.id);
    let following=true;
    if(idx>=0){db.follows.splice(idx,1);following=false;} else db.follows.push({id:uid(),followerId:me.id,followingId:user.id,createdAt:nowIso()});
    writeDb(db); return sendJson(res,200,{following});
  }

  const feedPath = '/api/feed';
  if (u.pathname === feedPath && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const followedIds = db.follows.filter((f)=>f.followerId===me.id).map((f)=>f.followingId);
    const allowed = new Set([me.id, ...followedIds]);
    const posts = db.posts.filter((p)=>allowed.has(p.authorId)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map((p)=>postDto(db,p,me.id));
    return sendJson(res,200,{posts});
  }

  if (u.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
  if (!serveFile(res, u.pathname)) sendJson(res, 404, { error: 'Not found' });
});

ensureDb();
server.listen(PORT, () => console.log(`VP backend running on http://0.0.0.0:${PORT}`));

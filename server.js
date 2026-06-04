const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'vp_dev_secret_change_me';
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || ROOT);
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, 'db.json'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads'));
const VPSC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
const DB_ENVELOPE_VERSION = 1;
const USE_POSTGRES = !!process.env.DATABASE_URL;
const SUPABASE_DB_CONFIG = {
  user: 'postgres.sfkeodbjvkvuphylgatc',
  password: 'UVOempGPz5X0Msmw',
  host: 'aws-1-eu-central-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres'
};
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const VPSC_PEPPER = process.env.VPSC_PEPPER || process.env.DB_ENCRYPTION_KEY || SECRET;
let dbCache = null;
let pgPool = null;
let pgReady = false;

function emptyDb() {
  return { users: [], posts: [], comments: [], likes: [], follows: [], stories: [], postViews: [], commentLikes: [], meta: { postSeq: 1, commentSeq: 1, vpscAttempts: {} } };
}


function getPgConfig() {
  if (!process.env.DATABASE_URL) return null;
  return {
    ...SUPABASE_DB_CONFIG,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  };
}

function getPgPool() {
  if (!pgPool) {
    pgPool = new Pool(getPgConfig());
  }
  return pgPool;
}

function toDateValue(value) {
  if (!value) return nowIso();
  return value instanceof Date ? value.toISOString() : String(value);
}

function camelUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    bio: row.bio || '',
    avatar: row.avatar || 'U',
    avatarUrl: row.avatar_url || '',
    bannerUrl: row.banner_url || '',
    favoriteTrackName: row.favorite_track_name || '',
    favoriteTrackUrl: row.favorite_track_url || '',
    favoriteTracks: Array.isArray(row.favorite_tracks) ? row.favorite_tracks : [],
    vpscHash: row.vpsc_hash || '',
    vpsc: row.legacy_vpsc ? decryptSecretValue(row.legacy_vpsc) : '',
    pinnedPostId: row.pinned_post_id == null ? null : row.pinned_post_id,
    pinnedRepostId: row.pinned_repost_id == null ? null : row.pinned_repost_id,
    createdAt: toDateValue(row.created_at)
  };
}

function camelPost(row) {
  return {
    id: Number(row.id),
    publicId: row.public_id || '',
    authorId: row.author_id,
    text: row.text || '',
    media: Array.isArray(row.media) ? row.media : [],
    repostOf: row.repost_of == null ? null : Number(row.repost_of),
    createdAt: toDateValue(row.created_at)
  };
}

function getVpscSecret() {
  if (!VPSC_PEPPER || VPSC_PEPPER === 'vp_dev_secret_change_me') {
    console.warn('WARNING: set VPSC_PEPPER in production; VPSC codes are account recovery credentials.');
  }
  return String(VPSC_PEPPER || SECRET);
}

function hashVpsc(code) {
  return crypto.createHmac('sha256', getVpscSecret()).update(String(code || '').trim().toUpperCase()).digest('hex');
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ''));
}

function isLegacyShaHash(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

async function hashPassword(password) {
  return bcrypt.hash(String(password || ''), BCRYPT_ROUNDS);
}

async function verifyPassword(password, storedHash) {
  const stored = String(storedHash || '');
  if (isBcryptHash(stored)) return bcrypt.compare(String(password || ''), stored);
  if (isLegacyShaHash(stored)) return sha(password) === stored;
  return false;
}

async function ensurePgSchema() {
  if (pgReady || !USE_POSTGRES) return;
  const pool = getPgPool();
  await pool.query(`
    create table if not exists app_meta (
      key text primary key,
      value jsonb not null
    );
    create table if not exists users (
      id text primary key,
      username text not null unique,
      display_name text not null,
      password_hash text not null,
      bio text not null default '',
      avatar text not null default 'U',
      avatar_url text not null default '',
      banner_url text not null default '',
      favorite_track_name text not null default '',
      favorite_track_url text not null default '',
      favorite_tracks jsonb not null default '[]'::jsonb,
      vpsc_hash text unique,
      legacy_vpsc text,
      pinned_post_id integer,
      pinned_repost_id integer,
      created_at timestamptz not null default now()
    );
    create table if not exists posts (
      id integer primary key,
      public_id text not null unique,
      author_id text not null references users(id) on delete cascade,
      text text not null default '',
      media jsonb not null default '[]'::jsonb,
      repost_of integer references posts(id) on delete cascade deferrable initially deferred,
      created_at timestamptz not null default now()
    );
    create table if not exists comments (
      id integer primary key,
      post_id integer not null references posts(id) on delete cascade,
      parent_id integer references comments(id) on delete cascade deferrable initially deferred,
      author_id text not null references users(id) on delete cascade,
      text text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists likes (
      id text primary key,
      post_id integer not null references posts(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      unique(post_id, user_id)
    );
    create table if not exists follows (
      id text primary key,
      follower_id text not null references users(id) on delete cascade,
      following_id text not null references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      unique(follower_id, following_id)
    );
    create table if not exists stories (
      id text primary key,
      author_id text not null references users(id) on delete cascade,
      src text not null,
      media_type text not null default 'image',
      caption text not null default '',
      created_at timestamptz not null default now()
    );
    create table if not exists post_views (
      id text primary key,
      post_id integer not null references posts(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      unique(post_id, user_id)
    );
    create table if not exists comment_likes (
      id text primary key,
      comment_id integer not null references comments(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      unique(comment_id, user_id)
    );
    create table if not exists vpsc_attempts (
      ip_hash text primary key,
      fails integer not null default 0,
      blocked_until bigint not null default 0,
      updated_at timestamptz not null default now()
    );
    create index if not exists idx_posts_author_created on posts(author_id, created_at desc);
    create index if not exists idx_posts_created on posts(created_at desc);
    create index if not exists idx_comments_post_created on comments(post_id, created_at);
    create index if not exists idx_follows_follower on follows(follower_id);
    create index if not exists idx_follows_following on follows(following_id);
    create index if not exists idx_likes_post on likes(post_id);
    create index if not exists idx_post_views_post on post_views(post_id);
  `);
  pgReady = true;
}

function getDbKey() {
  const raw = process.env.DB_ENCRYPTION_KEY || SECRET;
  if (!raw || raw === 'vp_dev_secret_change_me') {
    console.warn('WARNING: set JWT_SECRET and DB_ENCRYPTION_KEY in production to keep tokens and encrypted data portable between hosts.');
  }
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function encryptDb(db) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getDbKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(db), 'utf8'), cipher.final()]);
  return JSON.stringify({ v: DB_ENVELOPE_VERSION, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }, null, 2);
}

function decryptDb(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return emptyDb();
  const parsed = JSON.parse(trimmed);
  if (parsed && parsed.alg === 'aes-256-gcm' && parsed.iv && parsed.tag && parsed.data) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getDbKey(), Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]).toString('utf8'));
  }
  return parsed;
}


function encryptSecretValue(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getDbKey(), iv);
  const data = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]);
  return JSON.stringify({ alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

function decryptSecretValue(value) {
  const raw = String(value || '');
  if (!raw) return '';
  if (!raw.trim().startsWith('{')) return raw;
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.alg !== 'aes-256-gcm') return raw;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getDbKey(), Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]).toString('utf8');
}

function normalizeDb(db) {
  const next = db && typeof db === 'object' ? db : emptyDb();
  next.users ||= []; next.posts ||= []; next.comments ||= []; next.likes ||= []; next.follows ||= []; next.stories ||= []; next.commentLikes ||= []; next.postViews ||= [];
  next.users.forEach((u) => {
    if (typeof u.favoriteTrackName !== 'string') u.favoriteTrackName = '';
    if (typeof u.favoriteTrackUrl !== 'string') u.favoriteTrackUrl = '';
    if (!Array.isArray(u.favoriteTracks)) {
      u.favoriteTracks = (u.favoriteTrackUrl && u.favoriteTrackName) ? [{ name: String(u.favoriteTrackName).slice(0, 140), url: String(u.favoriteTrackUrl), coverUrl: '', createdAt: u.createdAt || nowIso() }] : [];
    }
  });
  if (!next.meta) next.meta = { postSeq: 1, commentSeq: 1, vpscAttempts: {} };
  if (!next.meta.postSeq) next.meta.postSeq = 1;
  if (!next.meta.commentSeq) next.meta.commentSeq = 1;
  if (!next.meta.vpscAttempts) next.meta.vpscAttempts = {};
  return next;
}

function persistDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, encryptDb(db));
  fs.renameSync(tmp, DB_PATH);
}

async function readPgDb() {
  await ensurePgSchema();
  const pool = getPgPool();
  const hasUsers = await pool.query('select exists (select 1 from users limit 1) as has_users');
  if (!hasUsers.rows[0]?.has_users && fs.existsSync(DB_PATH)) {
    const migrated = normalizeDb(decryptDb(fs.readFileSync(DB_PATH, 'utf8')));
    if (migrated.users.length || migrated.posts.length || migrated.comments.length) {
      await writePgDb(migrated);
    }
  }
  const [users, posts, comments, likes, follows, stories, postViews, commentLikes, meta, attempts] = await Promise.all([
    pool.query('select * from users order by created_at, id'),
    pool.query('select * from posts order by id'),
    pool.query('select * from comments order by id'),
    pool.query('select * from likes order by created_at, id'),
    pool.query('select * from follows order by created_at, id'),
    pool.query('select * from stories order by created_at, id'),
    pool.query('select * from post_views order by created_at, id'),
    pool.query('select * from comment_likes order by created_at, id'),
    pool.query("select value from app_meta where key = 'seq'"),
    pool.query('select * from vpsc_attempts')
  ]);
  const db = {
    users: users.rows.map(camelUser),
    posts: posts.rows.map(camelPost),
    comments: comments.rows.map((r) => ({ id: Number(r.id), postId: Number(r.post_id), parentId: r.parent_id == null ? null : Number(r.parent_id), authorId: r.author_id, text: r.text || '', createdAt: toDateValue(r.created_at) })),
    likes: likes.rows.map((r) => ({ id: r.id, postId: Number(r.post_id), userId: r.user_id, createdAt: toDateValue(r.created_at) })),
    follows: follows.rows.map((r) => ({ id: r.id, followerId: r.follower_id, followingId: r.following_id, createdAt: toDateValue(r.created_at) })),
    stories: stories.rows.map((r) => ({ id: r.id, authorId: r.author_id, src: r.src, mediaType: r.media_type, caption: r.caption || '', createdAt: toDateValue(r.created_at) })),
    postViews: postViews.rows.map((r) => ({ id: r.id, postId: Number(r.post_id), userId: r.user_id, createdAt: toDateValue(r.created_at) })),
    commentLikes: commentLikes.rows.map((r) => ({ id: r.id, commentId: Number(r.comment_id), userId: r.user_id, createdAt: toDateValue(r.created_at) })),
    meta: meta.rows[0]?.value || { postSeq: 1, commentSeq: 1, vpscAttempts: {} }
  };
  db.meta.vpscAttempts = {};
  attempts.rows.forEach((r) => { db.meta.vpscAttempts[r.ip_hash] = { fails: Number(r.fails) || 0, blockedUntil: Number(r.blocked_until) || 0 }; });
  dbCache = normalizeDb(db);
  return dbCache;
}

async function writePgDb(db) {
  await ensurePgSchema();
  const next = normalizeDb(db);
  const client = await getPgPool().connect();
  try {
    await client.query('begin');
    await client.query('set constraints all deferred');
    await client.query('delete from comment_likes');
    await client.query('delete from post_views');
    await client.query('delete from likes');
    await client.query('delete from follows');
    await client.query('delete from stories');
    await client.query('delete from comments');
    await client.query('delete from posts');
    await client.query('delete from users');
    await client.query('delete from vpsc_attempts');
    for (const user of next.users) {
      if (!user.vpscHash && user.vpsc) user.vpscHash = hashVpsc(user.vpsc);
      await client.query(
        `insert into users (id, username, display_name, password_hash, bio, avatar, avatar_url, banner_url, favorite_track_name, favorite_track_url, favorite_tracks, vpsc_hash, legacy_vpsc, pinned_post_id, pinned_repost_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)`,
        [user.id, user.username, user.displayName || '', user.passwordHash, user.bio || '', user.avatar || 'U', user.avatarUrl || '', user.bannerUrl || '', user.favoriteTrackName || '', user.favoriteTrackUrl || '', JSON.stringify(user.favoriteTracks || []), user.vpscHash || null, user.vpsc ? encryptSecretValue(user.vpsc) : null, user.pinnedPostId || null, user.pinnedRepostId || null, user.createdAt || nowIso()]
      );
    }
    for (const post of next.posts) {
      await client.query(
        `insert into posts (id, public_id, author_id, text, media, repost_of, created_at) values ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [post.id, post.publicId || `vp_${post.id.toString(36)}`, post.authorId, post.text || '', JSON.stringify(post.media || []), post.repostOf || null, post.createdAt || nowIso()]
      );
    }
    for (const comment of next.comments) {
      await client.query(
        `insert into comments (id, post_id, parent_id, author_id, text, created_at) values ($1,$2,$3,$4,$5,$6)`,
        [comment.id, comment.postId, comment.parentId || null, comment.authorId, comment.text || '', comment.createdAt || nowIso()]
      );
    }
    for (const like of next.likes) await client.query(`insert into likes (id, post_id, user_id, created_at) values ($1,$2,$3,$4) on conflict (post_id, user_id) do nothing`, [like.id || uid(), like.postId, like.userId, like.createdAt || nowIso()]);
    for (const follow of next.follows) await client.query(`insert into follows (id, follower_id, following_id, created_at) values ($1,$2,$3,$4) on conflict (follower_id, following_id) do nothing`, [follow.id || uid(), follow.followerId, follow.followingId, follow.createdAt || nowIso()]);
    for (const story of next.stories) await client.query(`insert into stories (id, author_id, src, media_type, caption, created_at) values ($1,$2,$3,$4,$5,$6)`, [story.id || uid(), story.authorId, story.src, story.mediaType || 'image', story.caption || '', story.createdAt || nowIso()]);
    for (const view of next.postViews) await client.query(`insert into post_views (id, post_id, user_id, created_at) values ($1,$2,$3,$4) on conflict (post_id, user_id) do nothing`, [view.id || uid(), view.postId, view.userId, view.createdAt || nowIso()]);
    for (const like of next.commentLikes) await client.query(`insert into comment_likes (id, comment_id, user_id, created_at) values ($1,$2,$3,$4) on conflict (comment_id, user_id) do nothing`, [like.id || uid(), like.commentId, like.userId, like.createdAt || nowIso()]);
    const attempts = next.meta.vpscAttempts || {};
    for (const [ipHash, limit] of Object.entries(attempts)) {
      await client.query(`insert into vpsc_attempts (ip_hash, fails, blocked_until, updated_at) values ($1,$2,$3,now())`, [ipHash, Number(limit.fails) || 0, Number(limit.blockedUntil) || 0]);
    }
    await client.query(`insert into app_meta (key, value) values ('seq', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify({ postSeq: next.meta.postSeq || 1, commentSeq: next.meta.commentSeq || 1 })]);
    await client.query('commit');
    dbCache = next;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function ensureDb() {
  if (USE_POSTGRES) return readPgDb();
  if (dbCache) return dbCache;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    dbCache = emptyDb();
    persistDb(dbCache);
    return dbCache;
  }
  dbCache = normalizeDb(decryptDb(fs.readFileSync(DB_PATH, 'utf8')));
  persistDb(dbCache);
  return dbCache;
}
async function readDb() { return ensureDb(); }
async function writeDb(db) {
  if (USE_POSTGRES) return writePgDb(db);
  dbCache = normalizeDb(db);
  persistDb(dbCache);
}
const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomBytes(12).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const usernameRe = /^[a-zA-Z0-9_.]{5,24}$/;
const postIdRe = /^[a-zA-Z0-9_-]{6,64}$/;
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
  const before = db.stories.length;
  db.stories = db.stories.filter((s) => new Date(s.createdAt).getTime() >= ttl);
  return before !== db.stories.length;
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
  const { passwordHash, vpscHash, ...safe } = u;
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
  const filePath = path.join(UPLOAD_DIR, path.basename(relativePath));
  if (!filePath.startsWith(UPLOAD_DIR)) return;
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
  return db.comments.filter((c) => c.postId === postId).length;
}

function postDto(db, post, viewerId) {
  const author = db.users.find((u) => u.id === post.authorId);
  const likes = db.likes.filter((l) => l.postId === post.id).length;
  const comments = countAllComments(db, post.id);
  const reposts = db.posts.filter((p) => p.repostOf === post.id).length;
  const views = db.postViews.filter((v) => v.postId === post.id).length;
  const source = post.repostOf ? db.posts.find((p) => p.id === post.repostOf) : null;
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
    liked: !!db.likes.find((l) => l.postId === post.id && l.userId === viewerId),
    reposted: !!db.posts.find((p) => p.repostOf === post.id && p.authorId === viewerId),
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

function publicFilePath(pathname) {
  let f = pathname === '/' ? '/index.html' : pathname;
  if (pathname === '/privacy') f = '/privacy.html';
  if (pathname === '/terms') f = '/terms.html';
  if (pathname === '/login' || pathname === '/tape' || /^\/post\/[a-zA-Z0-9_-]+$/.test(pathname) || /^\/user\/[a-zA-Z0-9_.-]+$/.test(pathname)) f = '/index.html';
  const decoded = decodeURIComponent(f).replace(/\\/g, '/');
  if (decoded.includes('\0')) return null;
  if (decoded.startsWith('/uploads/')) {
    const uploadPath = path.resolve(UPLOAD_DIR, decoded.slice('/uploads/'.length));
    if (!uploadPath.startsWith(`${UPLOAD_DIR}${path.sep}`)) return null;
    return uploadPath;
  }
  const allowedRootFiles = new Set(['/index.html', '/privacy.html', '/terms.html', '/logo.png', '/logo_splash.png', '/stories.png', '/vpizde.png']);
  const isAsset = decoded.startsWith('/assets/') && !decoded.slice('/assets/'.length).includes('/');
  if (!allowedRootFiles.has(decoded) && !isAsset) return null;
  const fp = path.resolve(ROOT, `.${decoded}`);
  if (!fp.startsWith(`${ROOT}${path.sep}`) && fp !== ROOT) return null;
  return fp;
}

function securityHeaders(type) {
  return {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cache-Control': type.startsWith('text/html') ? 'no-store' : 'public, max-age=31536000, immutable'
  };
}

function wrapProtectedHtml(html) {
  const encoded = Buffer.from(html, 'utf8').toString('base64');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VP 2.0</title></head><body><script>(()=>{const b='${encoded}';const bytes=Uint8Array.from(atob(b),c=>c.charCodeAt(0));document.open();document.write(new TextDecoder().decode(bytes));document.close();})();</script></body></html>`;
}

function serveFile(res, pathname) {
  const fp = publicFilePath(pathname);
  if (!fp || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return false;
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
  res.writeHead(200, securityHeaders(type));
  if (path.basename(fp) === 'index.html') {
    res.end(wrapProtectedHtml(fs.readFileSync(fp, 'utf8')));
    return true;
  }
  fs.createReadStream(fp).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const db = await readDb();
  if (gc(db)) await writeDb(db);

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
    while (db.users.some((x) => x.vpscHash === hashVpsc(code) || x.vpsc === code)) code = makeVpsc();

    const user = {
      id: uid(),
      username,
      displayName,
      passwordHash: await hashPassword(password),
      bio: '',
      avatar: (displayName[0] || 'U').toUpperCase(),
      avatarUrl: '',
      bannerUrl: '',
      favoriteTrackName: '',
      favoriteTrackUrl: '',
      favoriteTracks: [],
      vpscHash: hashVpsc(code),
      vpsc: code,
      pinnedPostId: null,
      pinnedRepostId: null,
      createdAt: nowIso()
    };
    db.users.push(user);
    await writeDb(db);
    return sendJson(res, 201, { token: signToken(user.id), user: sanitizeUser(user) });
  }

  if (u.pathname === '/api/auth/login' && req.method === 'POST') {
    const b = await parseBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    const user = db.users.find((x) => x.username === username);
    if (!user || !(await verifyPassword(password, user.passwordHash))) return sendJson(res, 401, { error: 'Invalid credentials' });
    if (!isBcryptHash(user.passwordHash)) {
      user.passwordHash = await hashPassword(password);
      await writeDb(db);
    }
    return sendJson(res, 200, { token: signToken(user.id), user: sanitizeUser(user) });
  }

  if (u.pathname === '/api/auth/vpsc' && req.method === 'POST') {
    const b = await parseBody(req);
    const code = String(b.code || '').trim().toUpperCase();
    const ipRaw = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const ipKey = crypto.createHmac('sha256', getVpscSecret()).update(`ip:${ipRaw}`).digest('hex');
    const limit = db.meta.vpscAttempts[ipKey] || { fails: 0, blockedUntil: 0 };
    if (limit.blockedUntil && limit.blockedUntil > Date.now()) {
      return sendJson(res, 429, { error: 'Вход по VPSC временно заблокирован на 24 часа' });
    }
    const codeHash = hashVpsc(code);
    const user = db.users.find((x) => x.vpscHash === codeHash || x.vpsc === code);
    if (!user) {
      limit.fails = (limit.fails || 0) + 1;
      if (limit.fails >= 10) {
        limit.fails = 0;
        limit.blockedUntil = Date.now() + 24 * 60 * 60 * 1000;
      }
      db.meta.vpscAttempts[ipKey] = limit;
      await writeDb(db);
      return sendJson(res, 401, { error: 'Неверный VPSC-код' });
    }
    if (user && !user.vpscHash) user.vpscHash = codeHash;
    db.meta.vpscAttempts[ipKey] = { fails: 0, blockedUntil: 0 };
    await writeDb(db);
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
    await writeDb(db);
    return sendJson(res, 200, { user: sanitizeUser(me) });
  }

  if (u.pathname === '/api/me/password' && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const b = await parseBody(req);
    const oldPassword = String(b.oldPassword || '');
    const newPassword = String(b.newPassword || '');
    if (!(await verifyPassword(oldPassword, me.passwordHash))) return sendJson(res, 400, { error: 'Неверный старый пароль' });
    if (newPassword.length < 4) return sendJson(res, 400, { error: 'Новый пароль минимум 4 символа' });
    me.passwordHash = await hashPassword(newPassword);
    await writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (u.pathname === '/api/me/delete' && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const b = await parseBody(req);
    const pw = String(b.password || '');
    if (!(await verifyPassword(pw, me.passwordHash))) return sendJson(res, 400, { error: 'Неверный пароль' });

    const userPostIds = new Set(db.posts.filter((p) => p.authorId === me.id).map((p) => p.id));
    db.posts = db.posts.filter((p) => p.authorId !== me.id && !userPostIds.has(p.repostOf));
    db.comments = db.comments.filter((c) => c.authorId !== me.id && !userPostIds.has(c.postId));
    db.likes = db.likes.filter((l) => l.userId !== me.id && !userPostIds.has(l.postId));
    db.follows = db.follows.filter((f) => f.followerId !== me.id && f.followingId !== me.id);
    db.stories = db.stories.filter((s) => s.authorId !== me.id);
    db.commentLikes = db.commentLikes.filter((l) => l.userId !== me.id && !db.comments.find((c) => c.id === l.commentId && c.authorId === me.id));
    db.users = db.users.filter((u2) => u2.id !== me.id);
    await writeDb(db);
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
    await writeDb(db);
    return sendJson(res, 201, { post: postDto(db, post, me.id) });
  }

  const mLike = u.pathname.match(/^\/api\/posts\/(\d+)\/like$/);
  if (mLike && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const postId = Number(mLike[1]);
    if (!db.posts.find((p) => p.id === postId)) return sendJson(res, 404, { error: 'Post not found' });
    const idx = db.likes.findIndex((l) => l.postId === postId && l.userId === me.id);
    let liked = true;
    if (idx >= 0) { db.likes.splice(idx, 1); liked = false; }
    else db.likes.push({ id: uid(), postId, userId: me.id, createdAt: nowIso() });
    await writeDb(db);
    return sendJson(res, 200, { liked, likes: db.likes.filter((l) => l.postId === postId).length });
  }

  const mView = u.pathname.match(/^\/api\/posts\/(\d+)\/view$/);
  if (mView && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const postId = Number(mView[1]);
    if (!db.posts.find((p) => p.id === postId)) return sendJson(res, 404, { error: 'Post not found' });
    const alreadyViewed = db.postViews.some((v) => v.postId === postId && v.userId === me.id);
    if (!alreadyViewed) {
      db.postViews.push({ id: uid(), postId, userId: me.id, createdAt: nowIso() });
      await writeDb(db);
    }
    const views = db.postViews.filter((v) => v.postId === postId).length;
    if (!alreadyViewed) broadcastViewUpdate(postId, views);
    return sendJson(res, 200, { views });
  }

  const mRepost = u.pathname.match(/^\/api\/posts\/(\d+)\/repost$/);
  if (mRepost && req.method === 'POST') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const postId = Number(mRepost[1]);
    const original = db.posts.find((p) => p.id === postId);
    if (!original) return sendJson(res, 404, { error: 'Post not found' });
    const existingIdx = db.posts.findIndex((p) => p.authorId === me.id && p.repostOf === postId);
    let reposted;
    if (existingIdx >= 0) {
      const repostId = db.posts[existingIdx].id;
      db.posts.splice(existingIdx, 1);
      db.comments = db.comments.filter((c) => c.postId !== repostId);
      db.likes = db.likes.filter((l) => l.postId !== repostId);
      reposted = false;
    } else {
      let publicId = makePostId();
      while (db.posts.some((p) => p.publicId === publicId)) publicId = makePostId();
      db.posts.push({ id: db.meta.postSeq++, publicId, authorId: me.id, text: '', media: [], repostOf: postId, createdAt: nowIso() });
      reposted = true;
    }
    await writeDb(db);
    return sendJson(res, 200, { reposted, reposts: db.posts.filter((p) => p.repostOf === postId).length });
  }

  const mCom = u.pathname.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (mCom && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const postId = Number(mCom[1]);
    const comments = db.comments
      .filter((c) => c.postId === postId)
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
    const postId = Number(mCom[1]);
    const b = await parseBody(req);
    const text = String(b.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'text required' });
    if (!db.posts.find((p) => p.id === postId)) return sendJson(res, 404, { error: 'Post not found' });
    db.comments.push({ id: db.meta.commentSeq++, postId, parentId: b.parentId || null, authorId: me.id, text: text.slice(0, 2000), createdAt: nowIso() });
    await writeDb(db);
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
    await writeDb(db);
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
    await writeDb(db);
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
    await writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  const mPostById = u.pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (mPostById && req.method === 'GET') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const identifier = String(mPostById[1] || '');
    let post = db.posts.find((p) => p.publicId === identifier);
    if (!post && /^vp_[a-z0-9]+$/i.test(identifier)) {
      const legacyId = Number.parseInt(identifier.slice(3), 36);
      if (Number.isFinite(legacyId)) post = db.posts.find((p) => p.id === legacyId);
    }
    if (!post && !postIdRe.test(identifier)) post = db.posts.find((p) => p.id === Number(identifier));
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
    await writeDb(db);
    return sendJson(res, 200, { post: postDto(db, post, me.id) });
  }

  const mDel = u.pathname.match(/^\/api\/posts\/(\d+)$/);
  if (mDel && req.method === 'DELETE') {
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    const id = Number(mDel[1]);
    const idx = db.posts.findIndex((p) => p.id === id && p.authorId === me.id);
    if (idx < 0) return sendJson(res, 404, { error: 'Post not found' });
    db.posts.splice(idx, 1);
    db.likes = db.likes.filter((l) => l.postId !== id);
    db.postViews = db.postViews.filter((v) => v.postId !== id);
    const removedComments = new Set(db.comments.filter((c) => c.postId === id).map((c) => c.id));
    db.comments = db.comments.filter((c) => c.postId !== id);
    db.commentLikes = db.commentLikes.filter((l) => !removedComments.has(l.commentId));
    await writeDb(db);
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
    await writeDb(db);
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
    await writeDb(db);
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
    const uploadDir = UPLOAD_DIR;
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
    const uploadDir = UPLOAD_DIR;
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

ensureDb().catch((err) => { console.error('Database init failed:', err); process.exit(1); });
server.listen(PORT, () => console.log(`VP backend running on http://0.0.0.0:${PORT}`));

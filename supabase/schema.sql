-- VP Social Supabase/PostgreSQL schema.
-- Run this in Supabase SQL Editor if you want to create tables manually.
-- The server also creates the same tables automatically on startup when DATABASE_URL is set.

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

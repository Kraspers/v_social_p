# Backend + Frontend Integration Specification (No Mocks)

## 1) Current frontend mock points that must be replaced

The current app keeps auth/session and user data in browser localStorage and also has hardcoded mock users in `index.html`. These points are the exact replacement targets for API integration:

- Auth/session storage via `localStorage` (`USERS_KEY`, `SESSION_KEY`, `getUsers`, `saveUsers`, `getSession`, `setSession`).
- Login/registration handlers (`doLogin`, `doRegister`, VPSC login flow).
- Search that merges local users and `mockUsers`.
- Hardcoded `mockUsers` object used as fallback identity source.

### Minimal frontend edit rule

Do **not** change visual/UI logic. Replace only data source layer:

- Keep existing screen/UX events.
- Replace localStorage and in-file objects with HTTP calls to backend.
- Keep component behavior and user flow unchanged.

---

## 2) Recommended stack and architecture

- Runtime: Node.js LTS
- Web framework: Express.js
- Entry point: `server.js`
- Database: PostgreSQL (primary recommendation)
- Auth: JWT (access + refresh token strategy)
- Password hashing: bcrypt
- Validation: schema-based request validation (e.g., Joi/Zod/express-validator)
- DB access: ORM/query builder (Prisma/Sequelize/Knex + SQL)
- Logging: request ID + structured logs
- Security: helmet, CORS allowlist, rate limit on auth endpoints

### Layered architecture

- `routes/` — HTTP contracts and route composition
- `controllers/` — transport layer (req/res mapping)
- `services/` — business logic and transactions
- `models/` — DB models/repository layer
- `middleware/` — auth, validation, error middleware
- `utils/` — shared helpers (pagination, mappers, time)

This structure is mandatory for growth and isolation of concerns.

---

## 3) Backend folder structure

```text
backend/
  server.js
  src/
    app.js
    config/
      env.js
      db.js
      cors.js
      jwt.js
    routes/
      index.js
      auth.routes.js
      users.routes.js
      posts.routes.js
      comments.routes.js
      likes.routes.js
      follows.routes.js
      feed.routes.js
    controllers/
      auth.controller.js
      users.controller.js
      posts.controller.js
      comments.controller.js
      likes.controller.js
      follows.controller.js
      feed.controller.js
    services/
      auth.service.js
      users.service.js
      posts.service.js
      comments.service.js
      likes.service.js
      follows.service.js
      feed.service.js
      notifications.service.js
    models/
      user.model.js
      profile.model.js
      post.model.js
      comment.model.js
      like.model.js
      follow.model.js
      session.model.js
    middleware/
      auth.middleware.js
      validate.middleware.js
      error.middleware.js
      not-found.middleware.js
      rate-limit.middleware.js
    validators/
      auth.validator.js
      users.validator.js
      posts.validator.js
      comments.validator.js
      follows.validator.js
      common.validator.js
    repositories/
      user.repository.js
      post.repository.js
      comment.repository.js
      follow.repository.js
      like.repository.js
      feed.repository.js
    db/
      migrations/
      seeds/
    docs/
      openapi.yaml
  package.json
  .env.example
```

---

## 4) `server.js` responsibilities

`server.js` contains only bootstrap concerns:

1. Load environment config.
2. Create Express app from `src/app.js`.
3. Connect to PostgreSQL.
4. Register process-level handlers (`SIGTERM`, `SIGINT`, `unhandledRejection`, `uncaughtException`).
5. Start HTTP server on `PORT`.
6. Graceful shutdown with connection close.

No domain logic inside `server.js`.

---

## 5) Environment variables (`.env`)

Required:

- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_TTL`
- `JWT_REFRESH_TTL`
- `CORS_ORIGIN`
- `BCRYPT_ROUNDS`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`
- `MAX_UPLOAD_SIZE_MB` (if media enabled)

---

## 6) PostgreSQL data model (normalized)

## 6.1 Users and profile

### `users`
- `id` (uuid, pk)
- `username` (varchar, unique, indexed)
- `email` (varchar, unique, nullable depending on product policy)
- `password_hash` (text)
- `status` (enum: active, blocked, deleted)
- `created_at`, `updated_at`
- `last_login_at`

### `profiles`
- `user_id` (uuid, pk, fk -> users.id)
- `display_name` (varchar)
- `bio` (text)
- `avatar_url` (text)
- `cover_url` (text)
- `location` (varchar)
- `website` (varchar)
- `birth_date` (date, optional)
- `is_private` (boolean)
- `updated_at`

### `sessions` (refresh token tracking)
- `id` (uuid, pk)
- `user_id` (uuid, fk)
- `refresh_token_hash` (text)
- `user_agent` (text)
- `ip` (inet/text)
- `expires_at` (timestamp)
- `revoked_at` (timestamp, nullable)
- `created_at`

## 6.2 Social graph

### `follows`
- `follower_id` (uuid, fk -> users.id)
- `following_id` (uuid, fk -> users.id)
- `created_at`
- Composite PK (`follower_id`, `following_id`)
- Constraint: `follower_id != following_id`

(If “friends” is strictly mutual, compute from reciprocal follow rows or add a dedicated `friendships` table.)

## 6.3 Content

### `posts`
- `id` (uuid, pk)
- `author_id` (uuid, fk -> users.id, indexed)
- `text` (text)
- `media_url` (text, nullable)
- `media_type` (enum: image, video, none)
- `visibility` (enum: public, followers, private)
- `is_deleted` (boolean)
- `created_at`, `updated_at`

### `comments`
- `id` (uuid, pk)
- `post_id` (uuid, fk -> posts.id, indexed)
- `author_id` (uuid, fk -> users.id)
- `parent_comment_id` (uuid, fk -> comments.id, nullable for threaded replies)
- `text` (text)
- `is_deleted` (boolean)
- `created_at`, `updated_at`

### `post_likes`
- `post_id` (uuid, fk -> posts.id)
- `user_id` (uuid, fk -> users.id)
- `created_at`
- Composite PK (`post_id`, `user_id`)

### `comment_likes` (optional if frontend supports)
- `comment_id` (uuid, fk -> comments.id)
- `user_id` (uuid, fk -> users.id)
- `created_at`
- Composite PK (`comment_id`, `user_id`)

## 6.4 Indexes

Required indexes:

- `posts(author_id, created_at desc)`
- `posts(created_at desc)`
- `comments(post_id, created_at asc)`
- `follows(follower_id)` and `follows(following_id)`
- `users(username)` unique
- Full text index for search fields as needed.

---

## 7) Domain models (service-level)

- **User**: auth identity + status.
- **Profile**: editable public user data.
- **Post**: author content and visibility.
- **Comment**: post discussion entry.
- **Like**: many-to-many reaction relationship.
- **Follow**: directed subscription edge.
- **Session**: refresh token lifecycle.

---

## 8) API contract (v1)

Base URL: `/api/v1`

Response envelope (recommended):
- Success: `{ "data": ..., "meta": ... }`
- Error: `{ "error": { "code": "...", "message": "...", "details": ... } }`

## 8.1 Auth

### `POST /auth/register`
- Body: `username`, `password`, `displayName`, optional `email`
- 201: created user + tokens
- Errors: 409 username/email exists, 422 validation

### `POST /auth/login`
- Body: `usernameOrEmail`, `password`
- 200: user summary + access token + refresh token
- Errors: 401 invalid credentials

### `POST /auth/refresh`
- Body: `refreshToken`
- 200: new access token (+ optional rotated refresh token)
- Errors: 401 invalid/revoked

### `POST /auth/logout`
- Auth required
- Body: current refresh token or session id
- 204

### `GET /auth/me`
- Auth required
- 200: current user + profile

## 8.2 Users / profiles

### `GET /users/:username`
- 200: public profile + counters + relation flags
- 404 if absent

### `PUT /users/me`
- Auth required
- Body: editable fields (`displayName`, `bio`, `avatarUrl`, etc.)
- 200: updated profile
- 422 validation

### `GET /users/:username/posts`
- Query: `cursor`, `limit`
- 200: paginated posts

### `GET /users/search`
- Query: `q`, `limit`, `cursor`
- 200: matching users

## 8.3 Posts

### `POST /posts`
- Auth required
- Body: `text`, optional `mediaUrl`, `visibility`
- 201: created post

### `GET /posts/:postId`
- 200: post details + author + engagement counters
- 404 if absent/deleted

### `DELETE /posts/:postId`
- Auth required, owner or moderator
- 204

### `GET /posts/:postId/comments`
- Query: `cursor`, `limit`
- 200: post comments

## 8.4 Likes

### `POST /posts/:postId/likes`
- Auth required
- 201 or 200 idempotent

### `DELETE /posts/:postId/likes`
- Auth required
- 204

(If comment likes used, mirror endpoints for comments.)

## 8.5 Comments

### `POST /posts/:postId/comments`
- Auth required
- Body: `text`, optional `parentCommentId`
- 201: created comment

### `PUT /comments/:commentId`
- Auth required, owner only
- Body: `text`
- 200: updated comment

### `DELETE /comments/:commentId`
- Auth required, owner/moderator
- 204

## 8.6 Follow / friends

### `POST /users/:username/follow`
- Auth required
- 200/201

### `DELETE /users/:username/follow`
- Auth required
- 204

### `GET /users/:username/followers`
- Query: cursor pagination
- 200 list

### `GET /users/:username/following`
- Query: cursor pagination
- 200 list

### `GET /users/:username/friends`
- 200 mutual connections (derived)

## 8.7 Feed

### `GET /feed`
- Auth required
- Query: `cursor`, `limit`
- 200: posts from followed users + own posts, newest first

Feed query rule:
- Include posts by users followed by current user plus self.
- Respect `visibility` and block/private constraints.
- Use cursor-based pagination for stable infinite scroll.

---

## 9) JWT auth model (full sync and multi-device)

- Access token short-lived (e.g., 15 min).
- Refresh token long-lived (e.g., 30 days), stored in `sessions` as hash.
- Token rotation on refresh.
- Revoke on logout (single-session or all sessions endpoint).
- Frontend stores access token in memory, refresh token in secure httpOnly cookie (recommended) or secure storage strategy.
- Every protected endpoint reads `Authorization: Bearer <access_token>`.

For “full user synchronization”:
- All user-changing actions must hit DB immediately.
- No client-side authoritative state.
- UI state always rehydrates from API (`/auth/me`, `/feed`, `/users/:username`, `/posts/:id/comments`).

---

## 10) Validation and error handling

## 10.1 Validation

Validate at route boundary:

- Username format/length, uniqueness.
- Password complexity and min length.
- Post text max length.
- Comment text max length.
- Pagination limits and cursor format.

Reject invalid payloads with `422` and machine-readable field errors.

## 10.2 Error middleware

Single centralized error handler:

- Map domain errors to HTTP status:
  - 400 bad request
  - 401 unauthorized
  - 403 forbidden
  - 404 not found
  - 409 conflict
  - 422 validation
  - 429 rate limit
  - 500 internal
- Return stable `error.code` values for frontend handling.

---

## 11) Frontend integration plan (minimal edits)

Frontend file to modify: `index.html` only (script section), because current project is single-file frontend.

## 11.1 Replace mock/local data layer

Create API adapter layer inside existing script (or extracted JS file if allowed):

- `api.auth.register/login/refresh/logout/me`
- `api.users.get/update/search/getPosts`
- `api.posts.create/get/delete`
- `api.comments.list/create/update/delete`
- `api.likes.likePost/unlikePost`
- `api.follows.follow/unfollow/listFollowers/listFollowing`
- `api.feed.get`

Then rewire existing handlers to these adapters:

- `doLogin` -> `/auth/login`
- `doRegister` -> `/auth/register`
- session bootstrap -> `/auth/me`
- search users -> `/users/search`
- post creation/feed render -> `/posts` + `/feed`
- likes/comments -> corresponding endpoints
- follow state -> follow endpoints

## 11.2 Remove fake sources completely

Delete usage of:
- `getUsers`, `saveUsers`
- `mockUsers`
- session in localStorage as source of truth

Allowed local storage usage only for non-authoritative UI cache (theme, last tab), not auth identity data.

## 11.3 Transport-level requirements

- Global API base URL via env/build-time variable (or constant in one place).
- Attach JWT access token to protected requests.
- Interceptor flow: on 401 attempt refresh once, then retry original request.
- If refresh fails: force logout and show login screen.

---

## 12) Exact frontend areas requiring replacement

In current `index.html`, replace logic around:

- Local auth storage helpers and session methods.
- Login/register functions.
- Search users function that merges mock + local users.
- `mockUsers` constant and references.

No CSS/layout changes required.

---

## 13) Security and “source code not visible” requirement

Important product reality:

- Browser frontend code is always downloadable/inspectable by users.
- It is **impossible** to make shipped client JS fully invisible.

What can be done instead:

1. Move all sensitive/business-critical logic to backend (already in this plan).
2. Do not expose secrets/tokens in client code.
3. Build/minify/obfuscate frontend bundle (raises effort, does not provide real secrecy).
4. Enforce authorization server-side for every protected action.
5. Keep anti-abuse checks, rate limits, moderation rules on backend only.

So: protect logic by server authority, not by hiding client source.

---

## 14) Migration sequence (zero-mock cutover)

1. Stand up backend skeleton and DB migrations.
2. Implement auth + users + `/auth/me` first.
3. Integrate frontend login/register/session bootstrap to real API.
4. Implement posts/feed/comments/likes/follows endpoints.
5. Replace each mock-dependent frontend call module-by-module.
6. Remove `mockUsers` and localStorage identity logic.
7. Run end-to-end checks for full user synchronization across devices/accounts.
8. Enable production hardening (rate limiting, CORS allowlist, secure cookies, logs).

Cutover done only when frontend reads all social data exclusively from DB-backed API.

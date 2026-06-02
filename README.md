# v_social_p

Backend запускается через `server.js` и отдаёт только публичные файлы приложения + REST API.

## Запуск

```bash
node server.js
```

Сервер поднимает:
- статику фронтенда (`index.html`, публичные изображения, `assets/*`, `uploads/*`),
- REST API на `http://localhost:3000/api/*`.

## Хранилище, Supabase и перенос между хостингами

Основной production-вариант — PostgreSQL/Supabase. Если задан `DATABASE_URL`, сервер сам создаёт нормализованные таблицы и хранит пользователей, посты, лайки, комментарии, подписки, просмотры, stories и лимиты VPSC в PostgreSQL. Схема также лежит в `supabase/schema.sql`.

В production обязательно задайте переменные окружения:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=long-random-token-secret
DB_ENCRYPTION_KEY=long-random-database-key
VPSC_PEPPER=long-random-vpsc-secret
```

- Пароли хранятся через bcrypt. Старые SHA-256 пароли автоматически обновляются до bcrypt после успешного входа.
- VPSC проверяется по HMAC-SHA-256 с `VPSC_PEPPER`; сам код дополнительно шифруется AES-256-GCM только для сохранения текущей логики показа/копирования VPSC в интерфейсе.
- При переносе на другой хостинг достаточно перенести env-переменные и подключиться к тому же Supabase `DATABASE_URL`.

Fallback для локальной разработки без `DATABASE_URL`: данные хранятся в зашифрованном файле `db.json` в формате AES-256-GCM. `DATA_DIR` — постоянная директория для `db.json` и `uploads/`; также доступны `DB_PATH` и `UPLOAD_DIR`.

## Защита исходников

HTTP-сервер больше не отдаёт произвольные файлы из репозитория. Через браузер доступны только whitelist-файлы: `index.html`, `privacy.html`, `terms.html`, корневые публичные картинки, `assets/*` и `uploads/*`. `server.js`, `package.json`, `db.json`, README и остальные служебные файлы не публикуются.

Важно: код, который выполняется в браузере, невозможно полностью скрыть от пользователя браузера. Его можно только минимизировать/обфусцировать на этапе отдельной сборки, но секреты и приватная логика должны оставаться на сервере.

## Реализованные backend-функции

- Регистрация / логин: `POST /api/auth/register`, `POST /api/auth/login`.
- Текущий пользователь + редактирование профиля: `GET /api/me`, `PATCH /api/me`.
- Посты: `GET /api/posts`, `POST /api/posts`, `DELETE /api/posts/:id`.
- Лайки: `POST /api/posts/:id/like`.
- Комментарии: `GET /api/posts/:id/comments`, `POST /api/posts/:id/comments`.
- Подписки: `GET /api/users/:username`, `POST /api/users/:username/follow`.
- Лента подписок: `GET /api/feed`.

## Интеграция с существующим frontend

Интерфейс не изменялся. В `index.html` используется backend token-based flow для авторизации, постов, комментариев и лайков.

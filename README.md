# v_social_p

Backend запускается через `server.js` и отдаёт только публичные файлы приложения + REST API.

## Запуск

```bash
node server.js
```

Сервер поднимает:
- статику фронтенда (`index.html`, публичные изображения, `assets/*`, `uploads/*`),
- REST API на `http://localhost:3000/api/*`.

## Хранилище и перенос между хостингами

По умолчанию данные хранятся в зашифрованном файле `db.json` в формате AES-256-GCM. Если задана переменная `DATABASE_URL`, backend подключается к PostgreSQL/Supabase, создаёт таблицу `app_state` и хранит в ней тот же зашифрованный снимок данных. При первом запуске с `DATABASE_URL` сервер автоматически импортирует существующий локальный `db.json`, если он есть.

В production обязательно задайте переменные окружения:

```bash
DATABASE_URL=postgresql://postgres.sfkeodbjvkvuphylgatc:[YOUR-PASSWORD]@aws-1-eu-central-1.pooler.supabase.com:6543/postgres
POSTGRES_SSL=true
JWT_SECRET=long-random-token-secret
DB_ENCRYPTION_KEY=long-random-database-key
DATA_DIR=/var/data
```

- `DATABASE_URL` — строка подключения к Supabase Shared Pooler. Пароль храните только в переменных окружения хостинга, не коммитьте его в репозиторий.
- `POSTGRES_SSL=true` — SSL для Supabase включён по умолчанию; `false` нужен только для локального PostgreSQL без SSL.
- `DB_ENCRYPTION_KEY` — ключ шифрования данных перед записью в файл или PostgreSQL. Используйте стабильное значение, иначе старые данные нельзя будет расшифровать.
- `DATA_DIR` — постоянная директория для локального `db.json` и `uploads/`. При Supabase база хранится в PostgreSQL, но загруженные файлы пока остаются в `UPLOAD_DIR`.
- Для переноса на другой хостинг используйте тот же `DATABASE_URL`, `DB_ENCRYPTION_KEY` и `JWT_SECRET`.
- Если нужно указать отдельные пути для файлового режима, доступны `DB_PATH` и `UPLOAD_DIR`.

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

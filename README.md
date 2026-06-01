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

Данные хранятся в зашифрованном файле `db.json` в формате AES-256-GCM. Сервер автоматически мигрирует старый plaintext `db.json` в encrypted envelope при старте.

В production обязательно задайте переменные окружения:

```bash
JWT_SECRET=long-random-token-secret
DB_ENCRYPTION_KEY=long-random-database-key
DATA_DIR=/var/data
```

- `DATA_DIR` — постоянная директория для `db.json` и `uploads/`, чтобы данные не стирались после перезапуска/сна хоста.
- Для переноса на другой хостинг скопируйте весь `DATA_DIR` и используйте тот же `DB_ENCRYPTION_KEY` и `JWT_SECRET`.
- Если нужно указать отдельные пути, доступны `DB_PATH` и `UPLOAD_DIR`.

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

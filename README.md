# v_social_p

Полноценный backend теперь встроен в проект и запускается через `server.js`.

## Запуск

```bash
node server.js
```

Сервер поднимает:
- статику фронтенда (`index.html`, `assets/*`),
- REST API на `http://localhost:3000/api/*`.

## Реализованные backend-функции

- Регистрация / логин: `POST /api/auth/register`, `POST /api/auth/login`.
- Текущий пользователь + редактирование профиля: `GET /api/me`, `PATCH /api/me`.
- Посты: `GET /api/posts`, `POST /api/posts`, `DELETE /api/posts/:id`.
- Лайки: `POST /api/posts/:id/like`.
- Комментарии: `GET /api/posts/:id/comments`, `POST /api/posts/:id/comments`.
- Подписки: `GET /api/users/:username`, `POST /api/users/:username/follow`.
- Лента подписок: `GET /api/feed`.

## Хранилище

Данные сохраняются в `db.json` (JSON-файл в корне проекта).

## Интеграция с существующим frontend

Интерфейс не изменялся. В `index.html` добавлен слой интеграции, который:
- переключает авторизацию на backend token-based flow;
- загружает посты, комментарии и лайки через API;
- отправляет создание постов/комментариев напрямую на сервер.

# Мастерская — конструктор интернет-магазинов

Облачная платформа, в которой владелец магазина создаёт витрину, управляет каталогом и заказами. Текущая версия — учебный MVP по требованиям первого семестра; промышленный выпуск и критерии дипломного проекта ещё впереди.

## Структура проекта

- `apps/admin` — рабочее место владельца и панель администратора: React, Vite, TypeScript, Redux Toolkit, PWA.
- `apps/storefront` — публичная платформа и витрины магазинов: Next.js, TypeScript, серверный рендеринг и SEO-метаданные.
- `services/api` — Koa API, PostgreSQL, Redis, OTP-аутентификация и OpenAPI.
- `infra` — Docker Compose и манифесты Kubernetes для k3s.
- `archive/prototype-v1` — предыдущий статический прототип.

План разработки находится в [roadmap](docs/roadmap.md), фактический статус требований — в [матрице соответствия](docs/requirements-traceability.md), решения по устройству сервисов — в [архитектуре](docs/architecture.md).

## Требования к окружению

- Node.js 22.12 или новее; для новых установок рекомендуется Node.js 24 LTS.
- npm 11 или совместимая версия.
- Docker Desktop и Compose v2 для запуска всего проекта.

## Запуск через Docker Compose

Запустите Docker Desktop, откройте терминал в корне проекта и выполните:

```powershell
npm install
docker compose -f infra/docker-compose.yml up --build
```

После сборки доступны:

- платформа и опубликованные витрины: `http://localhost:3000`;
- рабочее место: `http://localhost:5173`;
- API: `http://localhost:4000/api/v1`;
- Swagger UI: `http://localhost:4000/api/docs`.

Для локальной демонстрации создан пользователь `admin@example.test`. При включённом `EMAIL_DEBUG_CODE` одноразовый код отображается на экране входа. Для отправки писем настройте SMTP в окружении API.

## Запуск интерфейсов без контейнеров

PostgreSQL и Redis должны быть запущены и доступны по адресу из `services/api/.env.example`. Их можно поднять через Compose отдельно:

```powershell
docker compose -f infra/docker-compose.yml up -d postgres redis
Copy-Item services/api/.env.example services/api/.env
npm install
npm run db:migrate --workspace @shop-platform/api
npm run dev
```

## Полезные команды

```powershell
npm run build
npm run lint
npm run test
npm run test:coverage
npm run format
```

API хранит временные коды и refresh-сессии в Redis. Локальные данные покупателей, пароли и реальные платёжные реквизиты не добавляйте в репозиторий.

## Текущие ограничения

В MVP реализован сценарий создания магазина, настройки первого экрана, каталога, публикации, корзины и оформления заказа. Реальные платёжные и логистические провайдеры, генеративный ИИ-помощник, нагрузочное тестирование и промышленная эксплуатация относятся к следующим итерациям.

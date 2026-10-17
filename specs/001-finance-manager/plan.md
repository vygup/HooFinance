# Технический план: Finance Manager

**Контекст Spec Kit**: `001-finance-manager` | **Дата**: 2026-10-17 | **Спецификация**: [spec.md](spec.md).  
**Git-ветка**: `main` — сценарий setup вернул логическое имя feature из `.specify/feature.json`, переключение Git не выполнялось.  
**Статус**: проектирование завершено; приложение не реализовано.  
**Вход**: единая спецификация всего приложения; [конституция 1.0.0](../../.specify/memory/constitution.md).

## Краткое описание

Один модульный монолит Next.js для личных и семейных финансов. Все финансовые изменения проходят серверные application services, проверку пространства и единую PostgreSQL-транзакцию. Domain-функции decimal.js не зависят от React, transport или Drizzle. Better Auth обеспечивает сессии и организации; семейный доступ дополнительно ограничивается доменными инвариантами. Переводы имеют две связанные записи с приватными workspace-проекциями, audit и защитой повторов. Планы не создают деньги.

## Технический контекст

| Область | Решение |
| --- | --- |
| Язык/runtime | TypeScript 5.9.3 strict; Node.js 24 LTS |
| UI/framework | Next.js 16.4.2 App Router, React 19.3.1, Tailwind 4.3.3, shadcn/ui, Lucide |
| Сервер | Server Actions для форм, Route Handlers для auth, CSV и readiness; Node runtime |
| Данные | PostgreSQL 18, Drizzle 0.45.4, pg 8.23.1; миграции Drizzle Kit |
| Auth | Better Auth 1.7.10, Organization Plugin, server authorization facade |
| Формы/представления | Zod 4, React Hook Form 7, Recharts 3, TanStack Table 9 |
| Деньги | Decimal 10.6.0; NUMERIC/string; currency scale validation; точная пара сумм для FX |
| Проверки | Vitest 5.0.5: domain + реальные PostgreSQL integration; Playwright 1.64.1: browser E2E |
| Платформа | Self-hosted Linux, Docker Compose v2, Caddy 2; desktop/tablet/mobile browser |
| Объем | Один продукт, 24 истории P1–P3, 67 ФТ, 18 КУ; один app instance на начальном этапе |
| Производительность | Не вводить неутвержденный SLA; снять baseline на 10 одновременных пользователях и 100 000 операций в тестовом пространстве. Это инженерный профиль измерения, не продуктовый лимит или приемочный SLA |
| Ограничения | Корректность выше скорости; нет Redis, worker, billing, банковских API, автоматического списания или нового backend |

Выбранные exact npm версии, источники и ограничения совместимости: [research.md](research.md). Проверка peer metadata выполнена; сборка и runtime тесты еще не выполнялись. Docker patch/digest закрепляется при первой сборке, не использовать плавающий latest в выпуске.

## Проверка конституции

До исследования и после проектирования одинаковые критерии, отклонения не разрешены.

| Раздел | Проверка | До | После |
| --- | --- | --- | --- |
| I | Личные/семейные финансы, русский/RUB, SaaS только возможность развития | Пройдено | Пройдено |
| II | Весь обязательный стек сохранен, stable releases, lockfile при реализации | Пройдено | Пройдено |
| III | Один Next.js modular monolith; domain отдельно от UI/transport/DB | Пройдено | Пройдено |
| IV | Workspace ownership, server membership, приватные personal данные | Пройдено | Пройдено |
| V | NUMERIC/string/Decimal, атомарные переводы, audit, идемпотентность | Пройдено | Пройдено |
| VI | Auth plugin без обхода, Zod, secrets server-only, TLS, default deny | Пройдено | Пройдено |
| VII | Две темы, адаптивность, русская локаль, WCAG 2.2 AA, понятные состояния | Пройдено | Пройдено |
| VIII | Финансовые и security проверки обязательны до готовности функциональности | Пройдено | Пройдено |
| IX | Docker/Compose/Caddy, versioned migrations, backup/restore guide | Пройдено | Пройдено |
| Governance | Единственный spec, без самостоятельной смены финансовой модели | Пройдено | Пройдено |

«Пройдено» означает соответствие дизайна, не завершенную реализацию. Custom product checklist остается reviewer-owned и неизменным; его 40 вопросов не объявляются автоматически закрытыми. Конституция и чек-листы не редактируются. Единственное дополнение spec.md в этом этапе — явно согласованное владельцем правило перепланирования обязательств (вопрос 14).

## Структура проекта

### Артефакты проектирования

```text
specs/001-finance-manager/
  spec.md
  plan.md
  research.md
  data-model.md
  quickstart.md
  contracts/
    commands.md
    csv.md
  checklists/
    requirements.md
    product.md
```

`tasks.md` создается только отдельной командой, в этом этапе отсутствует.

### Планируемый исходный код

```text
src/
  app/
    (auth)/
    (finance)/w/[workspaceId]/
    api/auth/[...all]/
    api/workspaces/[workspaceId]/csv/
    api/health/
  modules/
    identity/
    workspaces/
    ledger/
    categories/
    budgeting/
    goals/
    obligations/
    planning/
    reporting/
    data-exchange/
  components/ui/
  components/shared/
  shared/money/
  shared/calendar/
  shared/contracts/
  server/auth/
  server/db/schema/
  server/db/migrations/
  server/security/
  server/mail/
tests/
  unit/
  integration/
  e2e/
deploy/
  Caddyfile
Dockerfile
compose.yaml
.env.example
```

В каждом предметном модуле только реально необходимые `domain`, `application`, `infrastructure`, `presentation` файлы. Без универсального repository framework и отдельного frontend/backend workspace. Компоненты общие только при повторном использовании. Серверные импорты помечаются server-only, DTO и типы отделены от секретов/соединений БД.

## Фаза 0 — Исследование

Результат: [research.md](research.md). Закрыты выборы versions, workspace/org mapping, точности, транзакций, календаря, CSV, self-hosted эксплуатации. Исследование Better Auth выполнено отдельным research-agent согласно навыку, итог консолидирован здесь; агент файлов не менял.

## Фаза 1 — Дизайн

При проектировании согласовано дополнительное правило перепланирования обязательств: наступившие неоплаченные и оплаченные экземпляры сохраняются, будущие неоплаченные пересчитываются. Решение внесено в spec.md (вопрос 14, ФТ-043, история 14).

Модель: [data-model.md](data-model.md). Application/transport contracts: [commands.md](contracts/commands.md). Формат обмена: [csv.md](contracts/csv.md). Проверяемый запуск и сценарии: [quickstart.md](quickstart.md).

### Серверный поток

Ниже описан поток команд существующего финансового пространства. Signup/signin/reset следуют отдельному identity-контракту Better Auth; регистрация атомарно создает user+personal workspace без предварительного scope. Profile.updateProfile проверяет собственную session и profile.version. CreateFamily создает scope внутри session-authorized транзакции. Изменение family name/timezone, принятие owner transfer и soft-delete проверяют и увеличивают workspace.version.

1. Session Better Auth → Zod transport validation → application context.
2. Транзакция, блокировки пространства/членства/счетов, повторное чтение прав и версий.
3. Чистые domain-правила Decimal/calendar определяют изменение и необходимость подтверждения минуса.
4. Атомарно записываются action/legs/revisions/balances/idempotency; commit.
5. Сервер формирует минимальный разрешенный DTO, без личных деталей противоположной стороны.

Queries также проверяют актуальный доступ, выбирают workspace rows и формируют согласованные отчеты на одном snapshot. Client не является источником aggregate, permission или monetary calculations.

### Матрица доступа

| Действие | Personal owner | Family owner | Family member | Бывший владелец deleted family |
| --- | --- | --- | --- | --- |
| Читать собственное/семейное | Да | Да | Да | Только история удаленной семьи |
| Общие финансы, budget/goals/categories/obligations | Только personal | Да | Да | Нет |
| Invite/remove/rename/timezone | Нет семейных прав | Да | Нет | Нет |
| Owner transfer / soft-delete | Нет семейных прав | По ФТ-011 | Только принять передачу | Нет |
| Cross-workspace transfer | Только между своим personal и семьей с текущим доступом | Только если также personal owner | Только если также personal owner | Нет |
| Экспорт | Personal | Family | Family | Только сохраненная история |

Роль owner не позволяет менять чужую личную сторону перевода. История audit проходит тот же privacy projection, что обычный DTO.

### Поэтапность одного продукта

| Последовательность | Приоритет/покрытие | Условие результата |
| --- | --- | --- |
| Основа | Конституция, runtime, DB, auth/workspaces; истории 1–2,17–18 | Изоляция и отсутствие обхода plugin доказаны интеграционно |
| Учет | P1 счета, категории, ledger, переводы, revisions; истории 3–6,21 | Балансы, rollback, race и повторные запросы проверены |
| Планирование | P1 бюджет, goals/reserves/savings, dashboard; истории 7–13,15 | Числовые КУ, zero/negative, календарь и rounding согласованы |
| Расширение | P2 obligations, unified planning, periods, CSV, FX; истории 14,16,19–20,22–23 | План/факт и multi-currency не смешиваются |
| Представление | P3 история 24 | Те же server totals в разных представлениях; a11y и mobile |

Минимальный экспорт deleted family доступен в P1 как обязательная зависимость ФТ-011, общий расширенный CSV — P2. Это не задачи реализации и не отдельные спецификации.

### Проверки качества

Дополнения после анализа согласованы владельцем: просрочка рассчитывается по истории активных расписаний независимо от просмотров; сроки и rate limits заданы в spec.md, вопрос 15. Счетчики PostgreSQL без Redis. US24 расширяет существующие queries и UI US16 без нового domain/repository/service.

Vitest: точные sums/scales, half-up/ceil, recommendation counts, goal/reseve states, budgets, schedule anchor, immutable input. Integration на реальном PostgreSQL: composite workspace FK, owner uniqueness, rollback transfer, lost-update, idempotency, membership revocation, protected auth endpoints, negative acknowledgement stale version, import rollback. Playwright: все 20 исходных сценариев + shared author editing, deleted-family export, FX pair, reset/invite mail fixture, две темы, keyboard/mobile и пустые состояния. Security regression включает прямые Route Handler/Server Action/auth plugin обращения; UI-only checks недостаточны.

### Эксплуатация

Private PostgreSQL, Caddy TLS, production origin allowlist, safe cookies, password/reset от Better Auth, audit privacy, secret encryption для сохраняемых конфиденциальных токенов. App и auth логи содержат correlation id, actor id, workspace id и error code без financial payload, email link query или secret. Readiness проверяет DB/schema; публичный endpoint не выдает конфигурацию. Backup вне публичных volumes, проверяемый restore перед обновлением. Финансовые данные сторонним сервисам не отправляются.

## Учет сложности

Нарушений конституции нет. Дополнительная инфраструктура не предусмотрена. Необходимые driver и UI peer dependencies обслуживают утвержденный стек; новые функции не добавляются. Реальные несовместимости выявленные при сборке требуют исправления в выбранном стеке, а изменение утвержденного стека — явного решения владельца.

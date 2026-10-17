# Исследование и решения

Дата: 2026-10-17. Основание: [единая спецификация](spec.md), [конституция](../../.specify/memory/constitution.md). Исследованы официальные документация, исходники и метаданные npm. Это проектные решения; установка зависимостей и проверка сборкой еще не выполнялись.

## 1. Совместимость и версии

**Решение:** Node.js 24 LTS, Next.js App Router 16, React 19; TypeScript 5.9.3 strict, без React Compiler, экспериментальных Next.js возможностей и shared financial cache. npm `latest` для TypeScript уже 7.0.2, но выбран существующий стабильный 5.9.3, чтобы не совмещать создание приложения с миграцией компилятора. PostgreSQL 18 stable; Caddy 2, Docker Compose v2. PostgreSQL 19 RC не использовать. Точные образы фиксировать patch+digest при сборке; пакетные версии ниже фиксировать и сохранять lockfile.

**Обоснование:** Node 24 имеет LTS-статус; выбранный Next требует Node >=20.9; Vitest 5 поддерживает Node 24. Метаданные Better Auth допускают Next 16, React 19 и Drizzle 0.45.2+, выбран Drizzle 0.45.4. Метаданные peerDependencies — предварительная совместимость, не доказательство работоспособности.

**Альтернативы:** Node 20 уже EOL; PostgreSQL RC, TypeScript latest и prerelease Drizzle не нужны. Новые backend-сервисы не нужны.

| Пакет | Выбранная версия |
| --- | --- |
| `@playwright/test` | `1.64.1` |
| `@tanstack/react-table` | `9.3.1` |
| `better-auth` | `1.7.10` |
| `decimal.js` | `10.6.0` |
| `drizzle-kit` | `0.31.11` |
| `drizzle-orm` | `0.45.4` |
| `lucide-react` | `1.58.0` |
| `next` | `16.4.2` |
| `pg` | `8.23.1` |
| `pnpm` | `12.14.0` |
| `react` | `19.3.1` |
| `react-dom` | `19.3.1` |
| `react-hook-form` | `7.90.0` |
| `recharts` | `3.10.1` |
| `tailwindcss` | `4.3.3` |
| `typescript` | `5.9.3` |
| `vitest` | `5.0.5` |
| `zod` | `4.6.7` |

shadcn/ui — исходные компоненты в репозитории, не альтернативный UI runtime. Его необходимые примитивы, `react-is` для Recharts, типы `pg`/React/Node и сборочные peer-зависимости устанавливаются только как необходимые части утвержденного стека; фиксируются в lockfile. Для Zod и React Hook Form возможна прямая передача ошибок без отдельного resolver-пакета. `pg` — необходимый драйвер PostgreSQL для Drizzle, не новый инфраструктурный компонент. Стиль: formatter/linter как инструменты контроля качества, без новых runtime-библиотек. pnpm exact в `packageManager`.

Источники: [Node lifecycle](https://nodejs.org/en/about/previous-releases), [Next installation](https://nextjs.org/docs/app/getting-started/installation), [Next metadata](https://registry.npmjs.org/next/latest), [Better Auth metadata](https://registry.npmjs.org/better-auth/latest), [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql), [Vitest](https://vitest.dev/guide/), [shadcn Next.js](https://ui.shadcn.com/docs/installation/next). Для каждой строки версии первичный источник — `https://registry.npmjs.org/<имя>/<версия>`; не считать latest воспроизводимым pin.

## 2. Пространства, организации и авторизация

**Решение:** личный workspace не является организацией; family workspace соответствует ровно одной Better Auth organization. Membership и invitation плагина — единственный источник семейного членства. Приложение ограничивает роли до `owner`/`member`; приглашение дает только `member`. `activeOrganizationId` не дает права доступа.

**Обоснование:** стандартный плагин допускает более широкие роли и операции, чем спецификация. Установить `disableOrganizationDeletion: true`; запретить штатный generic role update, создание второго owner и обход доменных правил через `/api/auth/*`. Для owner transfer — подтверждаемая application-команда и один PostgreSQL tx над plugin member rows, workspace owner и audit; интеграционный адаптер использует схему Organization Plugin, а не параллельную таблицу членства. Стандартный org delete не вызывать. Soft-delete сохраняет бывшего владельца; никакие новые member/invitation mutations не проходят для deleted workspace.

**Транзакционный контракт:** единый доменный адаптер управляет plugin-совместимыми таблицами в переданном Drizzle tx; plugin hooks/permissions также применяются. Все пути членства используют один порядок блокировок workspace → membership. Нельзя считать два `auth.api` вызова атомарными или вызывать HTTP внутри db.transaction. При необходимости используется server extension плагина с явной передачей tx. Наличие adapter transaction option не доказывает атомарность всего бизнес-действия; rollback и обход прямым auth endpoint — ранние обязательные интеграционные проверки. При невозможности безопасного адаптера реализация этого участка останавливается, стек самовольно не меняется.

Регистрация: запись user и personal workspace должна совершаться в одной БД-транзакции через интеграционный адаптер/transactional hook; UNIQUE owner для personal обеспечивает идемпотентность. Успех регистрации не возвращать без workspace; повтор provisioning восстанавливает отсутствующее пространство, не создает дубль. Пароль обрабатывает исключительно Better Auth.

Приглашение: непрозрачный секрет одноразового принятия доставляется только в письме, проверяется email текущей сессии; секрет не выводится в списке приглашений владельца, URL и токены не логируются. Это подтверждает владение почтой без изменения регистрации на обязательную верификацию всех пользователей. Отмененные и истекшие приглашения не принимаются. Сроки и серверные лимиты согласованы владельцем в spec.md, вопрос 15; defaults и конфигурация определены в contracts/commands.md. Счетчики хранятся в PostgreSQL, без Redis или нового сервиса. Почта обслуживается серверным SMTP-транспортом; если в имеющемся окружении нет транспорта, использовать необходимый минимальный SMTP-клиент, не платный SaaS. Не раскрывать финансовые данные в письмах.

**Альтернативы:** личная организация раскрывает ненужные membership-сценарии; доверие сессионному cache не обеспечивает немедленный отзыв; штатное hard delete уничтожает историю.

Источники: [Organization Plugin](https://better-auth.com/docs/plugins/organization), [Drizzle adapter source](https://github.com/better-auth/better-auth/blob/main/packages/drizzle-adapter/src/drizzle-adapter.ts), [adapter contracts](https://better-auth.com/docs/guides/create-a-db-adapter), [Next integration](https://better-auth.com/docs/integrations/next), [server authorization](https://nextjs.org/docs/app/guides/authentication). API необходимо сверить с зафиксированным release, а не переносить main без проверки.

## 3. Денежный учет

**Решение:** NUMERIC без typmod с серверной проверкой конечности, валюты и масштаба до записи; Drizzle возвращает строку. Это исключает автоматическое округление колонкой и не вводит самовольный продуктовый предел суммы. decimal.js считает суммы, балансы, агрегаты и рекомендации; никаких денежных вычислений через number. Текущий баланс — синхронная проекция истории, а не второй источник денег.

Для каждой группы точных сложений/вычитаний precision Decimal выбирается по максимальному числу целых разрядов, масштабу валюты и числу слагаемых с запасом, минимум 80 значащих цифр; при умножении учитывается сумма длин операндов. Деления для процентов и рекомендаций получают guard digits и явно финализируются до нужного масштаба. При пограничном округлении увеличить precision до устойчивого результата. Источник курса хранится как точная рациональная пара двух денежных сумм плюс decimal-представление: бесконечная дробь не используется для обратного изменения денег.

**Обоснование:** PostgreSQL NUMERIC и decimal.js точны при корректной настройке, но NUMERIC(p,s) может округлить ввод, а Decimal precision по умолчанию конечна. Вход отклоняется до записи при лишней дробной части, NaN/Infinity и экспоненциальной записи. ROUND_HALF_UP реализует половину от нуля; рекомендации ROUND_CEIL для неотрицательной недостающей суммы. Строковые итоги формируются сервером. Recharts получает только нормализованные безразмерные координаты, например доли от server-computed max; денежные tooltip и подписи — точные строки сервера. UI не пересчитывает деньги.

**Альтернативы:** float/number запрещен; целые minor units усложняют валютные масштабы и не заменяют обязательные decimal.js/NUMERIC; универсальный event sourcing и double-entry ERP не нужны. История revisions + две transfer legs достаточны.

Источники: [PostgreSQL numeric](https://www.postgresql.org/docs/18/datatype-numeric.html), [Drizzle types](https://orm.drizzle.team/docs/column-types), [decimal.js](https://mikemcl.github.io/decimal.js/).

## 4. Атомарность, повторы и гонки

**Решение:** финансовые команды используют db.transaction READ COMMITTED с явными блокировками workspace (по id), затем membership, action/revision и account (по id). Изменения членства/удаление также блокируют workspace. Повторная проверка прав выполняется после получения блокировки. Все деньги, audit, balance projection, installment link и idempotency outcome фиксируются одним tx. UNIQUE operation key + request hash отличает повтор от нового одинакового действия.

Обновления используют expectedVersion; stale edit возвращает конфликт вместо lost update. Предупреждение минуса связано с hash payload и versions затронутых счетов. Между preview и confirm суммы изменились — новое предупреждение, а не устаревшее разрешение. PostgreSQL deadlock/serialization error откатывает весь tx; ограниченный внутренний retry сохраняет тот же operation key, затем явная повторяемая ошибка.

Отчеты читают один snapshot REPEATABLE READ, выполняют Decimal-агрегацию разрешенных строк. Не кешировать финансовые отчеты между пользователями. После commit revalidation только нужных workspace views.

**Альтернативы:** Redis locks и очереди не нужны; уникальность только по сумме и дате уничтожает реальные одинаковые операции; optimistic lock без блокировки доступа не решает гонку исключения.

Источники: [PostgreSQL locking](https://www.postgresql.org/docs/18/explicit-locking.html), [Drizzle transactions](https://orm.drizzle.team/docs/transactions).

## 5. Даты, обязательства, CSV

**Решение:** финансовые даты DATE; системные timestamps timestamptz UTC. Часовой пояс пространства используется для «сегодня» и границ текущего периода; введенные даты не сдвигаются. Intl для календаря/форматирования, серверные функции календарных дней без арифметики миллисекунд суток. Расписание от исходной даты, отсутствие числа → конец месяца, исходный anchor не меняется. База хранит историю расписаний/периодов активности, подтвержденные occurrences и snapshots сумм; будущие создаются по запросу интервала, без фонового списания.

CSV: UTF-8, предосмотр с явным delimiter/date format/column mapping; потоковое чтение, quoted fields и multiline обязательны. Стабильный формат описан в contracts/csv.md. Транзакция охватывает весь явно подтвержденный корректный набор; ошибка финансового применения откатывает набор. Ошибочные строки исключаются еще до подтверждения. Точный повтор batch возвращает прежний результат. Fingerprint — только предложение возможного дубля, не причина удалить намеренную повторную операцию.

**Альтернативы:** автосписание, банковские API и автоматический FX не запрошены. Импорт не должен принимать две независимые строки перевода как доход/расход. Нативные средства достаточны для контрактного CSV; дополнительный parser добавляется только при доказанной необходимости безопасности/совместимости.

## 6. Развертывание, доставка и проверка

**Решение:** один Next.js Node container, PostgreSQL, Caddy; migrations как одноразовая команда того же image. Compose healthcheck проверяет готовность БД; app запускается после успешных миграций. SMTP — серверная конфигурация, в тестах mock transport; не требуется внешний платный поставщик. TLS Caddy, non-root app, приватная сеть PostgreSQL, volumes для БД и Caddy certificates, секреты только server env.

Backup: pg_dump custom format, pg_restore в отдельную пустую БД с exit-on-error/single-transaction; проверка migration version, counts, ownership, двух сторон переводов, Decimal-балансов и audit. Обновления предваряются backup и проверкой восстановления. Автоматический down migration финансовых данных не использовать; при неуспехе отключить writes, восстановить совместимый snapshot или применить проверенный forward fix. Не обещать нулевую потерю после аварии: dump сохраняет snapshot на начало backup; расписание и удержание задает self-hosted оператор.

**Альтернативы:** обязательные платные облака и отдельные scheduler/worker не нужны. Multi-instance кеш и горизонтальное масштабирование вне начального плана.

Источники: [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [Compose readiness](https://docs.docker.com/compose/how-tos/startup-order/), [Caddy HTTPS](https://caddyserver.com/docs/automatic-https), [PostgreSQL backup](https://www.postgresql.org/docs/18/backup-dump.html).

## 7. Граница решений плана

Product checklist остается 0/40, не является заявленным владельцем обязательным разрешением на планирование. Его отметки не изменяются. План не разрешает добавлять отсутствующие продуктовые функции. Неназванные SLO, банковские комиссии, автооценка FX и новый financial score не вводятся.

Разрешение P1/P2: минимальный просмотр/экспорт истории удаленной семьи входит в ФТ-011 P1 и использует общий CSV encoder; расширенный пользовательский импорт/экспорт остается P2. Требование доступных средств ФТ-053 остается P2. Это порядок зависимости, не новая спецификация и не изменение финансовых правил.

Нерешенных технических выборов этой фазы нет. Проверки совместимости сборкой, adapter rollback и security bypass являются проверками реализации выбранного решения, а не заявлением о уже пройденных тестах. Если реализация обнаружит необходимость изменить права, правила редактирования плановых экземпляров или денежные формулы, сначала уточнить тот же spec.md; план не подменяет решение владельца.

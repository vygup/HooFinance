# Руководство запуска и валидации

**Статус:** завершены Фазы 1–8 (T001–T066): каркас, foundation, регистрация/профиль, семьи, счета, доходы, расходы, управление категориями и переводы. Настройка и команды — [README](../../README.md); результаты Фазы 8 — [validation/us06.md](validation/us06.md). Бюджеты, цели и остальные предметные сценарии ниже относятся к последующим фазам единой спецификации.

Источники: [план](plan.md), [модель](data-model.md), [серверные контракты](contracts/commands.md), [CSV](contracts/csv.md). Не содержит кода приложения или тестовых реализаций.

## Предварительные условия

- Node.js 24 LTS, pnpm 12.14.0, Docker Engine + Compose v2.
- PostgreSQL 18 запускается Compose; для production hostname, Caddy TLS и доступный SMTP. В локальных автоматических проверках mail transport подменяется тестовым fixture без отправки реальным адресатам.
- Будущий `.env.example` содержит только имена и безопасные placeholders: DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, APP_ORIGIN, SMTP_HOST/PORT/USER/PASSWORD/FROM, TOKEN_ENCRYPTION_KEY, CADDY_HOST, CSV limits и preview lifetime. В `.env` реальные значения задает оператор, файл игнорируется Git. Ключи генерируются надежным random, не копируются из документации.
- Зафиксированные версии и миграции committed; все команды используют проектную pnpm version и frozen lockfile. PostgreSQL tests используют отдельную БД, никогда production credentials.

## Разработка после реализации foundation

Из корня репозитория:

```sh
cp .env.example .env
pnpm install --frozen-lockfile
docker compose -f compose.yaml -f compose.dev.yaml up -d db
pnpm db:migrate
pnpm dev
```

Перед запуском заполнить локальные значения `.env`; для автоматической проверки auth настроить test mail fixture, а не отключать проверку адресата приглашений. После миграции readiness должен подтверждать актуальную schema. Приложение открывается на `http://localhost:3000` для разработки; production HTTPS обслуживает Caddy.

Планируемые package scripts:

| Команда | Контракт |
| --- | --- |
| `pnpm dev` | Локальный Next.js dev server |
| `pnpm build` | Production build без обязательного контакта с production DB |
| `pnpm start` | Production Node server |
| `pnpm typecheck` | Strict TypeScript check |
| `pnpm lint` | Проверка стиля и запрещенных server/client импортов |
| `pnpm format:check` | Единое форматирование |
| `pnpm test:unit` | Vitest domain calculations/calendar |
| `pnpm test:integration` | Vitest с отдельным реальным PostgreSQL |
| `pnpm test:e2e` | Playwright с test server и mail fixture |
| `pnpm db:generate` | Создание versioned migration для review, не prod schema push |
| `pnpm db:migrate` | Применение проверенных migration |
| `pnpm db:verify-ledger` | Read-only Decimal reconciliation и проверка transfer/audit инвариантов |

## Обязательные проверки совместимости

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:unit
pnpm test:integration
pnpm build
pnpm test:e2e
```

Не считать совместимость доказанной только npm metadata. Первые integration checks основы: Drizzle NUMERIC возвращается строкой, tx-aware адаптер откатывает тестовую транзакцию, ограничения owner проверяются на fixtures, прямые plugin endpoints не обходят guard. После реализации US1 проверяется полный signup rollback, после US2 — family provisioning/owner transfer rollback, после US6 — rollback двухстороннего перевода. Нельзя требовать завершенных бизнес-сервисов до начала соответствующих историй; каждая история не считается завершенной без своих проверок.

## Сценарии сквозной проверки

Использовать локальных пользователей Анна, Борис и Вера, разные personal spaces и две семьи. Mail fixture показывает письма только в тестовом процессе. Никакие реальные письма или деньги не отправляются.

| Сценарий | Вход/действие | Ожидаемый результат |
| --- | --- | --- |
| Регистрация | Анна регистрируется, повторяет тот же запрос, выходит/восстанавливает пароль | Ровно один personal; financial data без session недоступны; reset не раскрывает старый пароль |
| Семья | Анна создает семью, приглашает Бориса, Борис принимает по письму | Member только этой семьи, personal данные изолированы |
| Прямой чужой запрос | Борис обращается к personal account Анны, CSV, goal, audit | Нет данных/личных названий/сумм, несмотря на общий family membership |
| Отзыв доступа | Борис открывает форму, Анна исключает, Борис подтверждает | Forbidden без финансового эффекта; повтор запросов также запрещен |
| Owner lifecycle | Борис повторно приглашен, принимает owner offer; Анна выходит | Один owner после подтверждения; до него Анна остается owner |
| Soft-delete | Единственный owner удаляет тестовую семью | Active picker пуст для нее, readonly history/export owner доступны, pending invites invalid |
| Балансы | Opening 100 000, income 20 000, expense 3 000 RUB | 117 000 RUB; income 20 000, expense 3 000 |
| Opening correction | Изменить opening на 90 000 | 107 000 RUB; income/expense прежние, audit before/after |
| Transfer | Перевести 10 000 между 50 000 и 20 000 RUB | 40 000/30 000, aggregate 70 000; no budget/income/expense effect |
| Rollback/retry | Искусственный сбой после первой leg; повтор того же operation key | Нет partial transfer; после успешного повтора ровно один action |
| Cross-space | Personal owner переводит в семью; другой member смотрит/пытается изменить | Family scoped amount/date/direction доступны; personal details и edit недоступны |
| Минус | Expense 1 500 при 1 000 RUB, отменить и подтвердить warning | Отмена 1 000, подтверждение −500; stale acknowledgement требует нового предупреждения |
| Budget | Planned income 200 000; limits 115 000; продукты limit 30 000/fact33 000 | Plan remaining85 000; category remaining−3 000,110%; transfer исключен |
| Reserve | Balance220 000, monthly50 000,12months | Target600 000, remaining380 000,36,67%,4,4months |
| Reserve changes | Пополнить20 000, снять50 000; изменить monthly55 000 | Derived показатели следуют реальному balance; target660 000 без новых денег |
| Zero/deficit | Monthly0; затем monthly>0 и balance−5 000 при target100 000 | No obligation с null percent/coverage; при положительной цели deficit/remaining105 000 |
| Savings | Remaining100 RUB,3 dates; today17Oct,target1Dec; изменить anchor | Recommendation33,34; default2 dates, новый anchor пересчитывает; no auto transactions |
| Calendar | Monthly31Jan2027, yearly29Feb2028, every2months | Feb end→31March; 29Feb2032 возвращается; положительный integer N |
| Replanning | Есть paid, overdue и future occurrences; изменить anchor/repeat | Paid и наступившие unpaid сохранены, future unpaid пересчитаны |
| Payment | Один occurrence подтвердить дважды | Ровно один expense; план сам не меняет balance |
| Timezone | Два члена семьи с разными личными поясами на границе месяца | Семейный месяц одинаков; финансовые даты не сдвигаются |
| Funds modes | Total300 000, goal account200 000, обязательства50 000 | Auto100 000; выбранные40 000+10 000 дают50 000; obligations отдельно |
| FX | Debit10 000 RUB, credit100 units | Обе суммы сохраняются; rate100 RUB/unit; нет общего FX-equivalent без явных правил |
| CSV | Valid/invalid/duplicate/transfer строки, preview, confirm, repeat | Preview без effect; result по выбранному набору; no partial batch, no silent duplicates |
| Reports | Month/custom/year, edit/delete past expense | Один scoped snapshot; пересчет затронутых периодов, целей и balances |
| UI | Desktop/tablet/mobile, обе темы, keyboard | Полные суммы доступны, focus и ошибки понятны, dirty input не теряется |

Ссылки на полный набор ожидаемых величин: spec.md §КУ-001–018. Integration сценарии включают конкурентный invite accept/delete, два owner acceptance и race membership removal/write. Положительный UI-сценарий не заменяет прямые server security checks.

## Self-hosted запуск после реализации

```sh
docker compose build app
docker compose up -d db
docker compose run --rm migrate
docker compose up -d app caddy
docker compose ps
```

Ожидается: migrate exit0, db healthy, ready endpoint готов, Caddy выдает HTTPS для настроенного hostname. БД не опубликована в интернет. App non-root, secrets только runtime, production cookies secure. Образы pin patch+digest, volume layout документируется в README. Compose startup не считается заменой healthcheck.

## Backup и проверка восстановления

На тестовом или согласованном оператором self-hosted окружении с существующим `backups/`:

```sh
docker compose exec -T db pg_dump -U finance -d finance -Fc > backups/finance.dump
docker compose exec -T db createdb -U finance finance_restore_check
docker compose exec -T db pg_restore -U finance -d finance_restore_check --exit-on-error --single-transaction < backups/finance.dump
```

Использовать отдельную новую БД, а не overwrite рабочего finance. Настроить отдельный validation environment URL на `finance_restore_check`, затем выполнить `pnpm db:verify-ledger` и integration чтение auth/workspaces/history. Проверяются schema version, число current actions/revisions, обе legs, opening/balance projections, unique owner и отсутствие чужого доступа. Отчет содержит только counts/ids/error codes, без financial payload. После проверки оператор управляет временной БД и сроками хранения backups; этот документ не выполняет удаление.

Backup содержит персональные данные: закрытый filesystem access и защищенное хранение обязательны. Шифровальные ключи восстанавливаются из отдельного секретного backup; dump без ключа не обеспечивает восстановление зашифрованных токенов. RPO зависит от последнего успешного backup, RTO измеряется восстановлением; не заявлять произвольный SLA как согласованный продуктовый критерий.

Перед обновлением: backup, restore validation, migration rehearsal на копии, maintenance write-stop на несовместимое изменение. При неуспехе не запускать разрушительный down migration финансовой истории; сохранять откат транзакции или восстанавливать совместимую копию в согласованной процедуре.

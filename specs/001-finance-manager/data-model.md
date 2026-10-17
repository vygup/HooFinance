# Модель данных Finance Manager

Основание: [spec.md](spec.md), решения: [research.md](research.md). Это описание будущей схемы, не миграции или реализация.

## Общие соглашения

- Идентификаторы application-объектов UUID; auth ids соответствуют Better Auth schema, не преобразуются насильно в UUID. Внешние ключи сохраняют реальный тип.
- Все финансовые таблицы содержат `workspace_id NOT NULL`. Связи финансовых сущностей используют составные FK `(workspace_id, entity_id)`, а не только глобальный id. На родителях UNIQUE `(workspace_id,id)`.
- Денежные поля NUMERIC без typmod, Drizzle string mode; finite decimal string, масштаб по поддерживаемому ISO currency catalog. Ввод проверяется до БД, CHECK запрещает специальные numeric значения; колонка не округляет лишние знаки. Положительность проверяется там, где требует spec.
- `financial_date` и даты планов — DATE; `created_at`, `updated_at`, `deleted_at`, audit timestamp — timestamptz UTC. Часовой пояс — валидный IANA identifier.
- Изменяемые объекты имеют `version` bigint для concurrency, передается строкой; бизнес-версии не вычисляются из времени. Status archive/delete не физическое уничтожение истории.
- User-facing audit и DTO проектируются для каждого workspace отдельно; JSON snapshots не должны обходить scope.

## Identity и пространства

| Сущность | Основные поля | Ограничения/связи |
| --- | --- | --- |
| Better Auth user | id, email, name, emailVerified, timestamps | Уникальность email по согласованной нормализации; пароль в plugin account, не финансовой таблице |
| session/account/verification | По generated Better Auth schema | Конфиденциальные сохраняемые токены шифруются, session secrets не выдаются финансовым DTO; политика Better Auth не заменяется самописными паролями |
| user_profile | user_id, locale, timezone, version | 1:1 user; основные preference поля не меняют email; version bigint NOT NULL DEFAULT 1, expectedVersion обязателен для изменения, успешное изменение увеличивает version на 1 |
| organization/member/invitation | По Organization Plugin schema | Family membership здесь; member UNIQUE(organization_id,user_id); роли только owner/member, никаких admin/multi-role |
| workspace | id, kind personal/family, personal_owner_id?, organization_id?, family_owner_id?, timezone?, deleted_at?, deleted_by?, version | personal: owner NOT NULL, organization NULL; family: organization/owner/timezone NOT NULL. Partial UNIQUE personal_owner_id при kind personal; UNIQUE organization_id; version bigint NOT NULL DEFAULT 1, rename/timezone/confirmed owner transfer/soft-delete проверяют expectedVersion и увеличивают version на 1 в том же tx |
| auth_rate_bucket | id, action, subject_hash, window_started_at, attempt_timestamps, expires_at | Серверные счетчики ограничений ФТ-066; ключ включает тип действия и нужное сочетание IP/почты/owner. Сырые пароли, токены и financial data не хранятся; обновление атомарно, лимит не обходится параллельными запросами. Это security-таблица, не финансовая сущность |
| ownership_offer | id, workspace_id, initiator_id, recipient_id, status pending/accepted/cancelled, workspace_version, timestamps | Получатель текущий family member. Принятие меняет owner/member в одном tx. Pending offers с устаревшей owner version не принимаются |
| workspace_user_preferences | workspace_id, user_id, available_mode auto/selected | UNIQUE(workspace,user); пользовательский выбор не меняет финансы семьи |
| spending_account_selection | workspace_id, user_id, account_id | FK к preference и account в том же workspace; UNIQUE triple |

Ровно один owner: partial UNIQUE по organization_id для member role owner обеспечивает максимум одного; deferred constraint trigger проверяет наличие ровно одного owner и совпадение с workspace.family_owner_id к концу транзакции. При transfer промежуточно допустимо ноль owner в tx, но commit без одного запрещен. Все owner writes только через доменный адаптер. Плагин не может повысить role в обход него. Deleted family сохраняет прежнее членство как историю; доступ только `deleted_by`, чтение/экспорт. Personal workspace нельзя удалять через org endpoints.

Создание family и Organization Plugin organization/member/workspace совершается одним tx; partial failure не оставляет пользовательски доступную половину пространства. Принятие приглашения блокирует workspace и актуальное invitation. Для отмененного/истекшего/deleted-family приглашения membership не создается.

## Счета и категории

| Сущность | Поля | Правила |
| --- | --- | --- |
| financial_account | id, workspace_id, name, type, currency, opening_balance, balance_projection, description?, archived_at?, version | Ровно один workspace и одна валюта; изменение currency/workspace не предоставляется. Opening balance допускает минус. Изменение opening сохраняет revision и влияет только на остатки |
| category | id, workspace_id, name, kind income/expense, archived_at?, version | Операция использует категорию соответствующего типа своего workspace. Архивация не удаляет FK; FK ON DELETE RESTRICT |

Balance projection всегда обновляется тем же tx, что history. Источник истины — current action revisions + opening balance. Проверка согласованности пересчитывает Decimal по истории, сравнивает с projection и сигнализирует о несовпадении; молча «чинить» деньги запрещено. Индексы account(workspace,archived), category(workspace,kind,archived).

## Ledger, переводы и аудит

| Сущность | Поля | Правила |
| --- | --- | --- |
| financial_action | id, creator_id, kind income/expense/transfer, current_revision, status active/deleted, version, created_at | Системная связь действия; не является финансовой записью без workspace. Не выдавать напрямую клиенту |
| action_revision | action_id, revision_no, actor_id, happened_at, reason?, status | UNIQUE(action,revision); immutable. Прежние versions сохраняются. Содержимое scoped legs хранится отдельно |
| ledger_leg | id, workspace_id, action_id, revision_no, account_id, role income/expense/transfer_out/transfer_in, amount, currency, financial_date, category_id?, private_description? | FK workspace/account и workspace/category. amount >0; category обязательна только income/expense. Валюта равна account.currency. UNIQUE(action,revision,role) |
| transfer_detail | action_id, revision_no, source_leg_id, destination_leg_id, rate_numerator, rate_denominator, rate_decimal, rate_direction | Ровно две legs, оба amounts >0, разные accounts; для одной currency суммы равны. Numerator=списание, denominator=зачисление — точное представление курса |
| scoped_audit_event | id, workspace_id, object_type/id, actor_id, occurred_at, revision_no, before_scope, after_scope, kind | Неизменяемый аудит только своих данных; события межпространственного действия создаются отдельно для обеих сторон |
| command_receipt | actor_id, operation_key, request_hash, status, action_id?, result_ref?, created_at | UNIQUE(actor,operation_key); тот же key с другим payload — conflict. Result заново scope-filtered при чтении, membership проверяется даже на retry |

Income/expense имеет одну leg и однозначный workspace. Перевод — системная группа, каждая leg однозначно scoped. Deferred DB constraint trigger проверяет количество legs, соответствие kind и наличие detail на текущей завершенной revision. Transfer edit/deletion создает новую revision целиком, не изменение одного плеча. Deleted current revision не участвует в balance/analytics, прежняя остается audit.

Transfer DTO family's side не содержит personal account id/name/balance/private description, сырой detail, приватный audit snapshot или скрытый endpoint к personal leg. Общий actor id отображается только как разрешенный семейный пользователь; секреты не попадают в JSON. При утрате членства или deleted family обе стороны перевода остаются неизменными; personal owner видит только personal leg. Domain permission не разрешает generic expense edit для transfer leg.

Индексы: legs(workspace,financial_date,id), legs(workspace,account_id,financial_date), legs(workspace,category_id,financial_date), revisions(action,revision), audit(workspace,occurred_at,id). FK history ON DELETE RESTRICT.

## Бюджеты, цели, резервы

| Сущность | Поля | Правила |
| --- | --- | --- |
| monthly_budget | id, workspace_id, month (первое число), currency, planned_income, version | UNIQUE(workspace,month,currency); plan >=0 |
| budget_limit | workspace_id, budget_id, category_id, amount | UNIQUE(budget,category), amount >=0, expense category; FK budget/category одного workspace |
| goal | id, workspace_id, name, description?, type ordinary/reserve, currency, account_id, ordinary_target?, target_date?, archived_at?, version | UNIQUE(workspace,account_id) WHERE archived_at IS NULL. ordinary target >0; reserve target вычисляется. Goal/account currency совпадает |
| reserve_settings | workspace_id, goal_id, monthly_amount, coverage_months, linked_obligation_id? | goal reserve, months integer >0, amount >=0; связь только с monthly N=1 того же workspace/currency |
| savings_plan | workspace_id, goal_id, anchor_date, anchor_day, monthly_contribution?, version | Одна конфигурация на goal; anchor date задается не раньше даты сохранения, day исходный. Фактические операции не создаются |

Факт бюджета, накопления, прогресс, достижение, недостающая сумма, месяцы покрытия, recommendation и forecast — вычисляемые server DTO, не самостоятельные денежные остатки. Расчеты используют согласованные исключения ФТ-039 и Decimal rounding. При linked obligation источником monthly amount является актуальная сумма obligation; поле ручной суммы используется после явного разрыва связи. Нельзя позволить смену currency связанной сущности без сохранения инварианта; используйте пересоздание/архивацию согласно доступным сценариям.

## Обязательства и импорт

| Сущность | Поля | Правила |
| --- | --- | --- |
| obligation | id, workspace_id, name, amount, currency, repeat_every, repeat_unit, anchor_date, anchor_day, category_id, account_id, status active/paused/archived, version | amount >=0, repeat_every positive integer, календарь ФТ-043, account currency/workspace и expense category совместимы |
| obligation_schedule_revision | id, workspace_id, obligation_id, revision_no, anchor_date, anchor_day, repeat_every, repeat_unit, amount, currency, active_from, active_until?, status active/paused/archived, recorded_at | Неизменяемые snapshots расписаний и интервалов активности; UNIQUE(obligation_id,revision_no), scoped FK. Старое расписание восстанавливает наступившую неоплаченную историю без зависимости от просмотров; изменения сохраняют наступившие и оплаченные экземпляры |
| obligation_occurrence | id, workspace_id, obligation_id, scheduled_date, scheduled_amount, currency, source_version, status planned/paid/superseded, payment_action_id? | Partial UNIQUE(obligation,scheduled_date) WHERE status != superseded; уникальный действующий payment action; snapshot суммы/даты оплаченного экземпляра сохраняется |
| import_batch | id, workspace_id, user_id, file_hash, mapping_snapshot, status preview/confirmed/rejected, version, result_summary | Preview ничего не меняет; confirmation key связывает выбранный набор, mapping и счет |
| import_row | workspace_id, batch_id, row_number, normalized_payload, validation_errors, fingerprint, resolution, action_id? | UNIQUE(batch,row); match fingerprint только candidate, не глобальный запрет одинаковых операций. Raw файл не публикуется и не пишется в logs |

Плановые экземпляры генерируются лениво по сохраненной истории расписаний и активных периодов. Просрочка определяется по истории расписания, а не только по ранее сохраненным экземплярам. Запрос платежей учитывает все наступившие неоплаченные платежи активных периодов, даже если пользователь раньше не открывал эти даты. Оплаченные, отмененные перепланированием экземпляры и периоды приостановки исключаются из неоплаченных. Просмотр не создает фактических расходов. Запрос просрочки рассчитывает прошлые активные интервалы от начала обязательства до сегодня, исключает оплаты и superseded occurrences и объединяет их с выбранным будущим интервалом; повторная материализация защищена уникальностью. Нельзя ограничиваться уже существующими occurrence rows. Оплаченные immutable snapshots не переписываются изменением актуальной obligation. Пауза/архивация не создает новых будущих экземпляров. При изменении anchor/repeat оплаченные и уже наступившие неоплаченные экземпляры сохраняются, будущие неоплаченные пересчитываются: владелец подтвердил это в вопросе 14 spec.md. Граница — scheduled_date <= today по часовому поясу пространства. Перестроение выполняется в том же tx с блокировкой obligation; removed future rows сохраняются как superseded для аудита, новая выборка их не считает. Пауза не стирает уже наступившие экземпляры; после возврата к active расчет возобновляется от текущего интервала без фиктивных оплат за паузу.

## Состояния и миграции

- Account/category: active → archived, ссылки и история сохраняются.
- Family: active → deleted после проверки единственного owner; обратно через продукт не переводится.
- Goal: active → archived; reached/deficit/no-obligation — derived state, не непоправимый lifecycle.
- Action: active revision → новая active/deleted revision; balance delta атомарна.
- Obligation: active → paused/archived; paid occurrence появляется только из подтвержденного расхода. Удаление оплаты возвращает экземпляр в planned в том же tx.
- Migration создается и проверяется на пустой БД и восстановленном backup; destructive schema changes не удаляют историю. CHECK/FK/UNIQUE/trigger описываются в versioned migration, Drizzle schema должна отражать ограничения насколько позволяет API.

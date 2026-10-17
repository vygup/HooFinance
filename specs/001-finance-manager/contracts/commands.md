# Контракты серверных действий и пользовательских представлений

Это проектные контракты, не реализованный API. Источники: [spec](../spec.md), [модель](../data-model.md). Server Actions и Route Handlers используют одни application services; отдельный публичный REST API продукта не вводится.

## Общие типы и ошибки

Money: `{ amount: string, currency: ISO4217 }`, без JSON number. Date — `YYYY-MM-DD`, timestamp — ISO UTC. Вход Zod: запрет unknown полей для команд, decimal конечный без экспоненты, масштаб валюты; validation повторно на сервере. Counts/проценты UI не используются как money.

Команды существующих финансовых пространств требуют подтвержденную session, workspace scope и `operationKey`; изменения существующих объектов также требуют `expectedVersion`. Actor определяется из session, а не из payload. Client-supplied account/category/goal ids проверяются в workspace. Scope и error DTO не раскрывают существование чужого объекта.

Identity-команды регистрации, входа, выхода и восстановления пароля используют контракт Better Auth, а не финансовый executor; существующий workspace и финансовый operationKey им не требуются. Регистрация атомарно создает пользователя и personal workspace отдельным транзакционным путем; вход и восстановление не требуют уже авторизованной session, выход проверяет session по правилам Better Auth. Profile.updateProfile требует session и expectedVersion собственного профиля, но не активное пространство. CreateFamily требует session и operationKey, но workspace scope получает из созданного пространства, а не требует его заранее.

`user_profile.version` и `workspace.version` — `bigint NOT NULL`, начальное значение 1, в DTO строка. Изменение профиля, названия или часового пояса семьи, подтвержденная передача владения и soft-delete проверяют соответствующий expectedVersion и увеличивают версию ровно на 1 в той же транзакции. При несовпадении — conflict без изменения данных; предложение передачи хранит workspace_version и не меняет владельца до подтверждения. Для профиля нет требования использовать финансовый receipt/ledger executor.

Результат — один из:

- success: id, version, безопасный result DTO;
- validation: fieldErrors, без данных БД/stack;
- unauthorized/forbidden/not_found: без чужих названий и сумм;
- conflict: stale version, operation key reused с другим hash либо объект уже изменен;
- confirmation_required: разрешенные рассчитанные остатки и opaque confirmation token;
- unavailable: действие не принято, повтор допускается с тем же operationKey.

Confirmation token связывает actor, normalized payload hash, versions счетов/объектов и scope. Повторное подтверждение не дает права пропустить проверки. Stale negative confirmation возвращает новое предупреждение. Тот же key с тем же payload возвращает уже принятый результат только после актуальной авторизации. Body errors не логируются с финансовыми полями.

## Ограничения авторизации и приглашений

Приглашение действует 7 суток; повторная отправка отменяет прежний секрет. Ссылка восстановления пароля одноразовая и действует 1 час. По умолчанию разрешено не более 5 неудачных попыток входа за 15 минут на сочетание IP и нормализованной почты; запросов восстановления — 3 за 15 минут на адрес и 10 на IP; отправок приглашений — 10 за час на владельца, повтор одному адресату не чаще раза в минуту. Ограничения проверяются на сервере, настраиваются конфигурацией и не раскрывают регистрацию адреса в ответе восстановления. IP определяется только из доверенного reverse proxy; клиентский произвольный X-Forwarded-For не дает новый лимит. Нормализация почты едина с auth lookup: trim/case normalization без удаления точек или plus-части. Повторное использование и истечение ссылки, повторная отправка, прямые auth endpoints и конкурентные запросы проверяются тестами.

## Каталог команд

| Область | Команда | Минимальный payload | Результат/инвариант |
| --- | --- | --- | --- |
| Identity | signup/signin/signout/reset | Better Auth email/password/reset token | Полный жизненный цикл пароля у Better Auth; signup завершается с personal workspace |
| Profile | updateProfile | name, locale, timezone, expectedVersion | Только собственный профиль; смены почты нет |
| Workspace | createFamily | name, operationKey | Organization/member/workspace атомарно; один owner |
| Workspace | renameFamily/setTimezone | workspaceId, name/timezone, expectedVersion | Owner only |
| Membership | invite/cancel/accept/reject/remove/leave | workspaceId, invite/member id; secret для accept | Organization Plugin schema/permissions; roles owner/member; invitation email ownership |
| Ownership | offer/accept | workspaceId, recipientId/offerId, expectedVersion | Одна подтверждаемая передача; максимум одна действующая версия; recipient member rechecked |
| Workspace | deleteFamily | workspaceId, expectedVersion, explicitConfirmation | Единственный owner; soft-delete + cancel pending invites; readonly история |
| Account | create/update/archive/correctOpening | name/type/currency/opening/description либо id/version | Валюта/workspace неизменны; opening correction audit; архив без потери денег |
| Category | create/update/archive | name, kind либо id/version | Scoped category, тип соответствует операции |
| Ledger | createIncome/createExpense | accountId, categoryId, amount, financialDate, description? | Валюта счета; один финансовый эффект |
| Ledger | transfer | sourceAccountId, destinationAccountId, debitAmount, creditAmount, date, scopedDescriptions? | FX курс derived; обе legs одним tx; same-currency суммы равны |
| Ledger | update/delete | actionId, expectedVersion, changedFields/explicitConfirmation | Новая revision; целый перевод, scope и cross-workspace permissions |
| Budget | save | month, currency, plannedIncome, categoryLimits, version | Один budget на scope/month/currency; fact derived |
| Goals | create/update/archive | type/name/account/target/date либо id/version | Один active goal/account, reserve subtype; derived savings |
| Reserves | configure/link/unlink | goalId, monthlyAmount/months/obligationId, version | Same currency/workspace, link только monthly N=1; нулевой платеж специальное состояние |
| Savings | configure | goalId, anchorDate, monthlyContribution?, version | Не создаёт деньги; server recommendation/forecast |
| Obligations | create/update/pause/archive | name/amount/recurrence/anchor/account/category либо id/version | Calendar N; изменение anchor/repeat сохраняет наступившие и оплаченные, пересчитывает будущие |
| Payments | confirm | occurrenceId, actualAmount, actualDate, operationKey | Ровно один действующий expense link; no automatic debit |
| Preferences | availableFunds | mode auto/selected, accountIds, workspaceId | Только собственные preference; currency-separated totals |
| CSV | preview/confirm/export | По [csv.md](csv.md) | Preview read-only, confirm атомарный набор, export scoped |

Для операций на deleted family mutating commands всегда forbidden, даже если standard auth endpoint иначе разрешил бы. Удаленный owner может query/export только history; cross-space mutation тоже запрещена. При заблокированной корректировке нельзя предлагать фальшивый income/expense вместо transfer.

## Queries и UI contracts

| Query/раздел | Параметры | Представление |
| --- | --- | --- |
| Workspace picker | current session | Только доступные активные; deleted отдельно только former owner |
| Accounts/categories | workspace, archive filters | Балансы и валюта точными строками, статус и scope |
| History | date bounds inclusive, account/category/search, cursor | Только scoped legs; stable ordering date/id; полная сумма в доступном тексте |
| Dashboard | workspace, current date by timezone | Per-currency balances, monthly income/expense/budget, goals/reserves, last actions; P2 payments |
| Planning | month/period | Подписанные plan/fact, goal deficits, coverage, obligations; funds modes без повторных вычетов |
| Analytics | month/previous/year/custom range | Те же current revisions и snapshot, что числовые показатели; transfers исключены |
| Goal detail | goal id | funds/remaining/percent/status, history account, recommendation/schedule/forecast |
| Upcoming | date interval | Overdue рассчитывается от начала истории активных расписаний независимо от прежних просмотров, future — по выбранному интервалу; каждый неоплаченный экземпляр один раз, paid/superseded/пауза исключены, просмотра недостаточно для расхода |

`progressStatus`: in_progress/reached/deficit/no_obligation; при deficit или no_obligation percent/coverage `null`, не NaN/Infinity. Actual накопления не ограничиваются нулем или target. Recommendation при reached — строка "0" в валюте; при отсутствии допустимых дат — null и явное состояние, не ложная нулевая потребность.

Денежные UI calculations запрещены. Для Recharts server DTO содержит exact display strings и normalized dimensionless coordinates. Currency totals — массив, не один неподтвержденный RUB equivalent.

Каждая форма имеет loading/error/success и сохранение ввода при ошибке; опасные действия отдельное подтверждение. Space switch с dirty form предупреждает до утраты ввода. Mobile, keyboard focus и обе темы включены в acceptance, технические messages не выводятся продуктовым пользователям.

## Route Handlers

- `/api/auth/[...all]`: библиотечный Better Auth protocol с server guard всех org mutating путей. Signup/signin/reset остаются доступны по правилам auth; нельзя блокировать их финансовым guard целиком.
- `/api/workspaces/[workspaceId]/csv/export`: GET, authenticated scoped CSV, `Cache-Control: private, no-store`, безопасный filename. Deleted-family former owner допускается.
- `/api/workspaces/[workspaceId]/csv/preview`: POST multipart, user/session/origin validation, лимиты входа server-configured; возвращает preview id.
- `/api/workspaces/[workspaceId]/csv/confirm`: POST, preview id/selected rows/resolutions/operationKey/confirmation token; no-store.
- `/api/health/live` и `/api/health/ready`: статус процесса и готовности БД/schema без конфигурации и пользовательских данных.

Read/query Server Components тоже проходят authorization facade. Origin/CSRF проверки, safe cookies, отсутствие персонального data cache обязательны; безопасность не сводится к наличию cookie на proxy.

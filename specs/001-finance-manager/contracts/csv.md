# Контракт CSV

Обмен относится к одному явно выбранному финансовому пространству. Финансовые правила остаются в [spec.md](../spec.md); ошибки и идемпотентность — в [commands.md](commands.md).

## Формат экспорта

UTF-8, BOM для совместимости с обычными табличными приложениями; delimiter `;`, header row, CRLF. Каждое текстовое поле quoted, внутренние quotes удваиваются; multiline description сохраняется. Decimal separator `.` без группировки, monetary fields — точные строки. Date `YYYY-MM-DD`.

Колонки версии 1:

`format_version;operation_id;revision;type;date;account;currency;amount;category;description;transfer_id;direction;counterparty_account;counterparty_currency;counterparty_amount;rate_numerator;rate_denominator`

- type: income/expense/transfer; direction только transfer: out/in.
- account/category — разрешенные названия; operation id — scope-local leg id, не скрытый personal id.
- amount положительная величина scoped leg, direction задает знак transfer.
- Internal transfer: две связанные строки, общий transfer_id; достаточные сведения обеих сторон доступны.
- Cross-workspace transfer: экспортируются только данные собственной стороны. Поля `counterparty_account`, `counterparty_currency`, `counterparty_amount`, `rate_numerator` и `rate_denominator` всегда пустые на обеих scoped выгрузках; скрытая сумма не раскрывается через курс или иные производные значения. Это правило действует также для просмотра истории удаленной семьи и audit export. Для внутреннего перевода одного пространства данные обеих сторон и параметры курса разрешены. Межпространственная строка является экспортом истории, не разрешением импортировать частичный перевод.
- Opening balance не export income, deleted revisions не экспортируются как действующие операции. Просмотр audit отделен от operation export; формат не утверждает полную копию базы.

CSV injection: текстовые поля, начинающиеся после пробельных/control символов с `=`, `+`, `-`, `@`, табуляции или CR, экранируются префиксом апострофа; исходный апостроф также экранируется. `format_version=1` определяет обратное снятие ровно одного защитного префикса только для собственного формата. Generic external CSV не подвергается догадкам о снятии апострофов. Денежные поля валидируются числовой грамматикой и не принимают формулы. Quoting само по себе не является защитой от формул.

## Предварительный просмотр

1. Пользователь выбирает workspace и основной счет, delimiter, сопоставление колонок, формат даты и десятичный разделитель. Экспортный формат распознается по version, но требуется явный preview.
2. Сервер проверяет session, актуальные права, account active/scope и входной размер. Технические лимиты файла/строк конфигурируемы, превышение дает явную ошибку до изменения данных; их значения документируются при реализации, не являются новым продуктовым тарифом.
3. Каждая строка нормализуется в command DTO; категория явно сопоставляется существующей категорией того же типа/пространства. Не создавать категории, счета или курсы молча.
4. Представлены original row number, normalized fields, ошибки и duplicate candidates, разрешенное действие accept/skip. Некорректные строки disabled для accept.
5. Для transfer нужно явно сопоставить оба разрешенных счета, direction и обе суммы; две строки собственного внутреннего перевода группируются в один action. Одиночная cross-space строка с приватно скрытой стороной не импортируется как частичный transfer или income.
6. File hash + mapping hash + normalized rows сохраняются в scoped preview, клиент не подменяет их при confirm.

## Подтверждение и повторы

Confirm включает preview id, выбранные корректные row ids и явно разрешенные возможные дубли. Точный ранее принятый batch возвращает прежний результат; filename не считается идентификатором. Экспортный operation id используется для обнаружения ранее принятых записей только в разрешенном scope. Fingerprint amount/date/account/type/description предлагает кандидат, а не автоматически запрещает одинаковую трату.

Все выбранные actions и batch result фиксируются одним tx; invalid rows пропускаются до подтверждения, а runtime failure откатывает весь принимаемый набор. При concurrent edit/member loss/stale negative confirmation нет скрытой частичной загрузки. Batch result дает accepted/skipped/rejected с row numbers и причинами; отсутствие подтверждения не меняет balances.

Raw CSV и preview доступны только инициатору с текущими правами пространства. Parsed rows не записываются в application logs и не отдаются другому участнику через угадывание preview id. Временный файл удаляется после завершения или истечения срока preview по настройке эксплуатации; аудит созданных финансовых действий сохраняется независимо от preview.

'use client';
import { setFamilyTimezoneAction } from './switching-actions';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  createFamilyInput,
  familyInput,
  type FamilyDto,
} from '../domain/family';
import {
  createFamilyAction,
  familyAction,
  invitationAction,
} from './family-actions';
import type { z } from 'zod';
const inputClass = 'w-full rounded-md border bg-background px-3 py-2';
const messages: Record<string, string> = {
  conflict: 'Семья уже изменена. Ввод сохранён. Загрузите актуальные данные.',
  forbidden: 'Действие недоступно. Проверьте состав семьи и свои права.',
  unauthorized: 'Войдите в аккаунт.',
  validation: 'Проверьте заполненные поля.',
  unavailable: 'Не удалось выполнить действие. Повторите попытку.',
};
function useFeedback() {
  const [message, setMessage] = useState(''),
    [error, setError] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  return {
    message,
    error,
    show: (status: string, text = 'Выполнено.') => {
      setError(status !== 'success');
      setMessage(
        status === 'success'
          ? text
          : (messages[status] ?? messages.unavailable!),
      );
    },
    node: (
      <p
        hidden={!message}
        ref={ref}
        tabIndex={-1}
        role={error ? 'alert' : 'status'}
        className="break-words"
      >
        {message}
      </p>
    ),
  };
}
export function CreateFamilyForm({
  timezone = 'Europe/Moscow',
}: {
  timezone?: string;
}) {
  const router = useRouter(),
    feedback = useFeedback();
  const key = useRef<string | null>(null);
  const form = useForm<{ name: string; timezone: string }>({
    defaultValues: { name: '', timezone },
  });
  useUnsavedChanges(form.formState.isDirty);
  return (
    <form
      className="grid gap-4 rounded-lg border p-5"
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          key.current ??= crypto.randomUUID();
          const parsed = createFamilyInput.safeParse({
            ...values,
            operationKey: key.current,
          });
          if (!parsed.success) {
            feedback.show('validation');
            for (const issue of parsed.error.issues) {
              const field = issue.path[0];
              if (field === 'name' || field === 'timezone') {
                form.setFocus(field);
                break;
              }
            }
            return;
          }
          const result = await createFamilyAction(parsed.data);
          feedback.show(result.status, 'Семья создана.');
          if (result.status === 'success') {
            key.current = null;
            form.reset();
            router.push(`/families?workspace=${result.data.id}`);
          }
        })(event);
      }}
    >
      <h2 className="text-xl font-medium">Новая семья</h2>
      <label>
        Название новой семьи
        <input className={inputClass} {...form.register('name')} />
      </label>
      <label>
        Часовой пояс новой семьи
        <input className={inputClass} {...form.register('timezone')} />
      </label>
      <Button disabled={form.formState.isSubmitting} type="submit">
        {form.formState.isSubmitting ? 'Создаём…' : 'Создать семью'}
      </Button>
      {feedback.node}
    </form>
  );
}
function CommandForm({
  scope,
  command,
  label,
  fields,
  confirm,
}: {
  scope: FamilyDto;
  command: z.infer<typeof familyInput>['command'];
  label: string;
  fields?: {
    name: string;
    label: string;
    value?: string;
    options?: { value: string; label: string }[];
  }[];
  confirm?: string;
}) {
  const feedback = useFeedback(),
    router = useRouter();
  const key = useRef<string | null>(null);
  const form = useForm<Record<string, string>>({
    defaultValues: Object.fromEntries(
      (fields ?? []).map((f) => [f.name, f.value ?? '']),
    ),
  });
  useUnsavedChanges(form.formState.isDirty);
  const defaults = JSON.stringify(
    Object.fromEntries((fields ?? []).map((f) => [f.name, f.value ?? ''])),
  );
  const {
    reset,
    formState: { isDirty },
  } = form;
  useEffect(() => {
    if (!isDirty) reset(JSON.parse(defaults) as Record<string, string>);
  }, [defaults, isDirty, reset]);
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          if (confirm && !window.confirm(confirm)) return;
          const payload = {
            command,
            ...values,
            ...(command === 'delete' ? { explicitConfirmation: true } : {}),
          };
          const parsed = familyInput.safeParse(payload);
          if (!parsed.success) {
            feedback.show('validation');
            if (fields?.[0]) form.setFocus(fields[0].name);
            return;
          }
          key.current ??= crypto.randomUUID();
          const result = await (
            command === 'timezone' ? setFamilyTimezoneAction : familyAction
          )(
            {
              workspaceId: scope.id,
              operationKey: key.current,
              expectedVersion: scope.version,
            },
            parsed.data.command === 'timezone'
              ? { timezone: parsed.data.timezone }
              : parsed.data,
          );
          feedback.show(result.status);
          if (result.status === 'success') {
            key.current = null;
            form.reset(
              command === 'rename' || command === 'timezone'
                ? values
                : undefined,
            );
            router.refresh();
          }
        })(event);
      }}
    >
      {fields?.map((field) =>
        ['memberId', 'invitationId', 'offerId'].includes(field.name) ? (
          <input
            key={field.name}
            type="hidden"
            {...form.register(field.name)}
          />
        ) : (
          <label key={field.name}>
            {field.label}
            {field.options ? (
              <select className={inputClass} {...form.register(field.name)}>
                <option value="">Выберите участника</option>
                {field.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input className={inputClass} {...form.register(field.name)} />
            )}
          </label>
        ),
      )}
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Подождите…' : label}
      </Button>
      {feedback.node}
      {feedback.error && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (
              window.confirm(
                'Загрузить актуальные данные? Ввод этой формы будет сброшен.',
              )
            ) {
              form.reset();
              key.current = null;
              router.refresh();
            }
          }}
        >
          Загрузить актуальные данные
        </Button>
      )}
    </form>
  );
}
export function FamilyForms({
  scope,
  actorId,
}: {
  scope: FamilyDto;
  actorId: string;
}) {
  return (
    <div className="grid gap-6">
      <p>
        Ваша роль: {scope.role === 'owner' ? 'владелец' : 'участник'} ·{' '}
        {scope.timezone}
      </p>
      {scope.role === 'owner' && (
        <>
          <CommandForm
            scope={scope}
            command="rename"
            label="Переименовать"
            fields={[
              { name: 'name', label: 'Название семьи', value: scope.name },
            ]}
          />
          <CommandForm
            scope={scope}
            command="timezone"
            label="Сохранить часовой пояс"
            fields={[
              {
                name: 'timezone',
                label: 'Часовой пояс семьи',
                value: scope.timezone,
              },
            ]}
          />
          <CommandForm
            scope={scope}
            command="invite"
            label="Пригласить"
            fields={[{ name: 'email', label: 'Почта приглашённого' }]}
          />
          <h3 className="text-xl font-medium">Ожидающие приглашения</h3>
          {scope.invitations.length === 0 && <p>Нет ожидающих приглашений.</p>}
          {scope.invitations.map((i) => (
            <div className="grid gap-2 break-words" key={i.id}>
              <p>{i.email}</p>
              <CommandForm
                scope={scope}
                command="cancelInvite"
                label="Отменить приглашение"
                fields={[
                  {
                    name: 'invitationId',
                    label: 'Номер приглашения',
                    value: i.id,
                  },
                ]}
              />
            </div>
          ))}
        </>
      )}
      <h3 className="text-xl font-medium">Участники</h3>
      {scope.members.map((m) => (
        <div
          key={m.id}
          className="grid gap-2 break-words rounded-md border p-3"
        >
          <p>
            {m.email} · {m.role === 'owner' ? 'владелец' : 'участник'}
          </p>
          {scope.role === 'owner' && m.role === 'member' && (
            <CommandForm
              scope={scope}
              command="remove"
              label="Исключить участника"
              confirm="Исключить участника из семьи?"
              fields={[
                { name: 'memberId', label: 'Номер участника', value: m.id },
              ]}
            />
          )}
        </div>
      ))}
      {scope.role === 'owner' && scope.members.length > 1 && (
        <CommandForm
          scope={scope}
          command="offer"
          label="Предложить передачу"
          fields={[
            {
              name: 'recipientId',
              label: 'Новый владелец',
              options: scope.members
                .filter((m) => m.role === 'member')
                .map((m) => ({ value: m.userId, label: m.email })),
            },
          ]}
        />
      )}
      {scope.offers.map((o) => (
        <div key={o.id}>
          <p>Передача владения ожидает подтверждения.</p>
          {o.recipientId === actorId ? (
            <CommandForm
              scope={scope}
              command="acceptOwnership"
              label="Принять владение"
              fields={[
                { name: 'offerId', label: 'Номер предложения', value: o.id },
              ]}
            />
          ) : (
            <CommandForm
              scope={scope}
              command="cancelOffer"
              label="Отменить передачу"
              fields={[
                { name: 'offerId', label: 'Номер предложения', value: o.id },
              ]}
            />
          )}
        </div>
      ))}
      {scope.role === 'member' && (
        <CommandForm
          scope={scope}
          command="leave"
          label="Покинуть семью"
          confirm="Покинуть семью? Доступ к общим данным прекратится."
        />
      )}
      {scope.role === 'owner' && scope.members.length === 1 && (
        <CommandForm
          scope={scope}
          command="delete"
          label="Удалить семью"
          confirm="Удалить семью? Она станет доступна только вам для просмотра истории и экспорта."
        />
      )}
    </div>
  );
}
export function InvitationForm({ secret }: { secret: string }) {
  const feedback = useFeedback(),
    [pending, startTransition] = useTransition();
  const keys = useRef<Record<string, string>>({});
  const respond = (decision: 'accept' | 'reject') =>
    startTransition(async () => {
      keys.current[decision] ??= crypto.randomUUID();
      const r = await invitationAction({
        secret,
        decision,
        operationKey: keys.current[decision],
      });
      feedback.show(
        r.status,
        decision === 'accept'
          ? 'Принято. Можно перейти к семьям.'
          : 'Приглашение отклонено.',
      );
    });
  return (
    <div className="grid gap-4">
      <Button disabled={pending} onClick={() => respond('accept')}>
        Принять приглашение
      </Button>
      <Button
        disabled={pending}
        variant="outline"
        onClick={() => respond('reject')}
      >
        Отклонить приглашение
      </Button>
      {feedback.node}
    </div>
  );
}

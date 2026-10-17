'use client';
import { useUnsavedChanges } from '@/components/shared/unsaved-changes';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { categoryInput, type CategoryDto } from '../domain/expenses';
import { categoryAction } from './category-actions';
function CategoryEditor({
  workspaceId,
  category,
}: {
  workspaceId: string;
  category?: CategoryDto;
}) {
  const router = useRouter();
  const form = useForm({
    defaultValues: {
      name: category?.name ?? '',
      kind: category?.kind ?? 'expense',
    },
  });
  const [message, setMessage] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);
  const dirty = form.formState.isDirty;
  useEffect(() => {
    if (message) statusRef.current?.focus();
  }, [message]);
  useUnsavedChanges(dirty);
  const key = useRef<string | null>(null);
  const submit = async (command: 'create' | 'update' | 'archive') => {
    const values = form.getValues();
    const input =
      command === 'create'
        ? { command, ...values }
        : command === 'update'
          ? { command, id: category!.id, name: values.name }
          : { command, id: category!.id };
    const parsed = categoryInput.safeParse(input);
    if (!parsed.success) {
      setMessage('Проверьте название категории.');
      form.setFocus('name');
      return;
    }
    if (
      command === 'archive' &&
      !window.confirm('Архивировать категорию? История сохранится.')
    )
      return;
    key.current ??= crypto.randomUUID();
    try {
      const r = await categoryAction(
        {
          workspaceId,
          operationKey: key.current,
          expectedVersion: category?.version,
        },
        parsed.data,
      );
      setMessage(
        r.status === 'success'
          ? 'Категория сохранена.'
          : r.status === 'conflict'
            ? 'Категория изменилась. Обновите страницу.'
            : 'Не удалось сохранить категорию.',
      );
      if (r.status === 'success') {
        key.current = null;
        if (!category) form.reset();
        router.refresh();
      }
    } catch {
      setMessage('Не удалось сохранить. Повторите попытку.');
    }
  };
  return (
    <form
      aria-label={category ? `Категория ${category.name}` : 'Новая категория'}
      className="grid gap-3 rounded border p-4"
      onSubmit={(event) => {
        void form.handleSubmit(() => submit(category ? 'update' : 'create'))(
          event,
        );
      }}
    >
      <label>
        Название категории
        <input
          className="block w-full rounded border bg-background p-2"
          {...form.register('name')}
          disabled={
            !form.formState.isReady ||
            form.formState.isSubmitting ||
            category?.archived
          }
        />
      </label>
      {!category && (
        <label>
          Тип категории
          <select
            className="block w-full rounded border bg-background p-2"
            {...form.register('kind')}
          >
            <option value="expense">Расход</option>
            <option value="income">Доход</option>
          </select>
        </label>
      )}
      {category && (
        <p>
          {category.kind === 'income' ? 'Доход' : 'Расход'} ·{' '}
          {category.archived ? 'Архивная' : 'Активная'}
        </p>
      )}
      <fieldset
        disabled={
          !form.formState.isReady ||
          form.formState.isSubmitting ||
          category?.archived
        }
        className="flex flex-wrap gap-3"
      >
        <Button type="submit">
          {form.formState.isSubmitting
            ? 'Сохраняем…'
            : category
              ? 'Переименовать'
              : 'Создать категорию'}
        </Button>
        {category && !category.archived && (
          <Button
            type="button"
            onClick={() => {
              void form.handleSubmit(() => submit('archive'))();
            }}
          >
            Архивировать категорию
          </Button>
        )}
      </fieldset>
      {message && (
        <p ref={statusRef} tabIndex={-1} role="status">
          {message}
        </p>
      )}
    </form>
  );
}
export function CategoryManager({
  workspaceId,
  categories,
}: {
  workspaceId: string;
  categories: CategoryDto[];
}) {
  return (
    <section aria-label="Управление категориями" className="grid gap-3">
      <h2 className="text-xl font-medium">Категории</h2>
      <CategoryEditor workspaceId={workspaceId} />
      {categories.length === 0 && <p>Категорий пока нет.</p>}
      {categories.map((c) => (
        <CategoryEditor
          key={`${c.id}:${c.version}`}
          workspaceId={workspaceId}
          category={c}
        />
      ))}
    </section>
  );
}

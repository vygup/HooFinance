'use client';
import type { ComponentProps } from 'react';
import { FinancialEntryForm } from './financial-entry-form';
export function ExpenseForm(
  props: Omit<ComponentProps<typeof FinancialEntryForm>, 'kind'>,
) {
  return <FinancialEntryForm {...props} kind="expense" />;
}

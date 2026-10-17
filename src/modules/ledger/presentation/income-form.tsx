'use client';
import type { ComponentProps } from 'react';
import { FinancialEntryForm } from './financial-entry-form';
export function IncomeForm(
  props: Omit<ComponentProps<typeof FinancialEntryForm>, 'kind'>,
) {
  return <FinancialEntryForm {...props} kind="income" />;
}

import { expect, test } from 'vitest';
import { schedulePayments, paymentTotals, canLinkReserve } from '@/modules/obligations/domain/overdue';
import { recurringPaymentInput } from '@/modules/obligations/application/recurring-payments-input';
const revision = { anchorDate: '2027-01-31', repeatEvery: 1, repeatUnit: 'month' as const, amount: '50000.00', currency: 'RUB', revisionNo: 1, activeFrom: '2027-01-01', activeUntil: null, status: 'active' as const };
test('Календарь N единиц сохраняет исходный день и восстанавливает 29 февраля', () => {
  expect(schedulePayments([revision], [], '2027-01-01', '2027-03-31', '2027-01-01').map(p => p.scheduledDate)).toEqual(['2027-01-31','2027-02-28','2027-03-31']);
  expect(schedulePayments([{...revision, repeatEvery: 2}], [], '2027-01-01', '2027-05-31', '2027-01-01').map(p => p.scheduledDate)).toEqual(['2027-01-31','2027-03-31','2027-05-31']);
  expect(schedulePayments([{...revision, anchorDate:'2028-02-29',repeatUnit:'year'}], [], '2028-01-01','2032-12-31','2028-01-01').at(-1)?.scheduledDate).toBe('2032-02-29');
  for (const repeatUnit of ['day','week'] as const) expect(schedulePayments([{...revision, repeatUnit, repeatEvery:2}], [], '2027-01-31','2027-02-14','2027-01-31').length).toBe(repeatUnit === 'day' ? 8 : 2);
});
test('Первый просмотр в апреле восстанавливает январь, исключает оплаты и отмены, без дублей', () => {
 const rows = schedulePayments([revision], [], '2027-04-01','2027-04-30','2027-04-15');
 expect(rows.map(p=>[p.scheduledDate,p.overdue])).toEqual([['2027-01-31',true],['2027-02-28',true],['2027-03-31',true],['2027-04-30',false]]);
 expect(paymentTotals(rows)).toEqual([{currency:'RUB',amount:'200000.00'}]);
 const existing = rows.map((p,i)=>({...p,status: i===0?'paid' as const:i===1?'superseded' as const:'planned' as const}));
 expect(schedulePayments([revision], existing,'2027-04-01','2027-04-30','2027-04-15').map(p=>p.scheduledDate)).toEqual(['2027-03-31','2027-04-30']);
});
test('Перепланирование сохраняет наступившие snapshots, пауза не создает платежей', () => {
 const history = [{...revision,activeUntil:'2027-03-15'}, {...revision,revisionNo:2,anchorDate:'2027-03-20',amount:'55000',activeFrom:'2027-03-16'}];
 const rows=schedulePayments(history, [],'2027-04-01','2027-04-30','2027-04-15');
 expect(rows.map(p=>[p.scheduledDate,p.scheduledAmount])).toEqual([['2027-01-31','50000.00'],['2027-02-28','50000.00'],['2027-03-20','55000.00'],['2027-04-20','55000.00']]);
 expect(schedulePayments([{...revision,status:'paused'}],[],'2027-01-01','2027-04-30','2027-04-15')).toEqual([]);
 expect(canLinkReserve({...revision,repeatEvery:2})).toBe(false);
 expect(canLinkReserve(revision)).toBe(true);
});
test('Строгий контракт отвергает неверный календарь, масштаб и неизвестные поля', () => {
 const input={command:'create',name:'Ипотека',amount:'50000',currency:'RUB',repeatEvery:1,repeatUnit:'month',anchorDate:'2027-01-31',accountId:'10000000-0000-4000-8000-000000000001',categoryId:'10000000-0000-4000-8000-000000000002'};
 expect(recurringPaymentInput.safeParse(input).success).toBe(true);
 for(const patch of [{repeatEvery:0},{repeatEvery:1.5},{anchorDate:'2027-02-29'},{amount:'1.001'},{amount:'-1'},{actorId:'fake'}]) expect(recurringPaymentInput.safeParse({...input,...patch}).success).toBe(false);
});

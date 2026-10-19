'use client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { AnalyticsReport } from '../application/analytics';
export function AnalyticsCharts({report}:{report:AnalyticsReport}) {
 return <div className="grid min-w-0 gap-6">{report.totals.map(t=><section key={t.currency} aria-label={`Графики ${t.currency}`}>
 <h3>Структура и динамика · {t.currency}</h3>
 <p>Шкала показывает доли. Точные суммы доступны в подсказках и таблицах.</p>
 <div className="h-64 min-w-0" role="img" aria-label={`Структура категорий ${t.currency}`}><ResponsiveContainer width="100%" height="100%"><BarChart data={report.categories.filter(c=>c.currency===t.currency).map(c=>({...c,label:`${c.role==='income'?'Доход':'Расход'}: ${c.name}`}))}><XAxis dataKey="label" hide/><YAxis domain={[0,1]}/><Tooltip content={({active,payload})=>active&&payload?.[0]?<p className="rounded border bg-background p-2">{payload[0].payload.label}: {payload[0].payload.amount} {t.currency}</p>:null}/><Bar dataKey="coordinate" fill="var(--foreground)"/></BarChart></ResponsiveContainer></div>
 <div className="h-64 min-w-0" role="img" aria-label={`Динамика ${t.currency}`}><ResponsiveContainer width="100%" height="100%"><BarChart data={report.dynamics.filter(d=>d.currency===t.currency)}><XAxis dataKey="date"/><YAxis domain={[0,1]}/><Tooltip content={({active,payload})=>active&&payload?.[0]?<p className="rounded border bg-background p-2">{payload[0].payload.date}<br/>Доходы: {payload[0].payload.income} {t.currency}<br/>Расходы: {payload[0].payload.expense} {t.currency}</p>:null}/><Bar dataKey="incomeCoordinate" fill="#15803d"/><Bar dataKey="expenseCoordinate" fill="#b91c1c"/></BarChart></ResponsiveContainer></div>
 </section>)}</div>;
}

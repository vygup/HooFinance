import Link from 'next/link';
import { Wallet } from 'lucide-react';
export default function Home() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-5 px-6 py-16"
    >
      <Wallet aria-hidden="true" className="size-10 text-primary" />
      <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
        Finance Manager
      </h1>
      <p className="text-xl">Личные и семейные финансы</p>
      <p className="max-w-prose leading-relaxed text-muted-foreground">
        Приложение находится в разработке. Управление счетами, операциями и
        финансовыми планами станет доступно в следующих этапах.
      </p>
      <nav
        aria-label="Аккаунт"
        className="flex flex-wrap gap-6 underline underline-offset-4"
      >
        <Link href="/register">Создать аккаунт</Link>
        <Link href="/login">Войти</Link>
      </nav>
    </main>
  );
}

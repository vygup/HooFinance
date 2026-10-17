import Link from 'next/link';
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto grid min-h-dvh w-full max-w-lg content-center gap-7 px-6 py-12"
    >
      <Link href="/" className="text-xl font-semibold">
        Finance Manager
      </Link>
      {children}
      <nav
        aria-label="Аккаунт"
        className="flex flex-wrap gap-5 text-sm underline underline-offset-4"
      >
        <Link href="/login">Вход</Link>
        <Link href="/register">Регистрация</Link>
        <Link href="/forgot-password">Забыли пароль?</Link>
      </nav>
    </main>
  );
}

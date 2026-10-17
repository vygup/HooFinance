import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Finance Manager',
  description: 'Личные и семейные финансы',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:m-4 focus:rounded focus:bg-background focus:p-3 focus:outline-2 focus:outline-ring"
        >
          Перейти к содержимому
        </a>
        {children}
      </body>
    </html>
  );
}

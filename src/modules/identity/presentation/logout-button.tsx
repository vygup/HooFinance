'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { logoutAction } from './logout-actions';
export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  return (
    <div>
      <Button
        variant="outline"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError('');
          try {
            const result = await logoutAction();
            if (result.status === 'success') {
              router.replace('/login');
            } else setError(result.message ?? 'Не удалось выйти.');
          } catch {
            setError('Нет связи с сервером. Попробуйте ещё раз.');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? 'Выходим…' : 'Выйти'}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

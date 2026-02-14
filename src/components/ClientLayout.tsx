'use client';

import { useAuth } from '@/lib/auth-context';
import { Navigation } from '@/components/Navigation';
import { ReactNode } from 'react';

export function ClientLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {isAuthenticated && <Navigation />}
      <main className={isAuthenticated ? 'flex-1 p-8 bg-gray-50' : 'flex-1'}>
        {children}
      </main>
    </div>
  );
}

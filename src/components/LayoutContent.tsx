'use client';

import { ReactNode, useEffect, useState } from 'react';
import { Navigation } from '@/components/Navigation';
import { useAuth } from '@/lib/auth-context';

export function LayoutContentWrapper({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const [mounted, setMounted] = useState(false);

  console.log('📍 LayoutContent - mounted:', mounted, 'loading:', loading, 'isAuthenticated:', isAuthenticated);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Show loading state while checking auth
  if (!mounted || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  console.log('📍 LayoutContent - rendering with isAuthenticated:', isAuthenticated);

  return (
    <div className="min-h-screen flex flex-col">
      {isAuthenticated && <Navigation />}
      <main className={isAuthenticated ? 'flex-1 p-4 sm:p-6 md:p-8 bg-gray-50 overflow-x-auto' : 'flex-1'}>
        {children}
      </main>
    </div>
  );
}

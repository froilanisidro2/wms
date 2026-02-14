/**
 * Protected Route Component
 * Redirects to login if not authenticated
 */

'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredPermission?: string;
}

export function ProtectedRoute({
  children,
  requiredPermission,
}: ProtectedRouteProps) {
  const router = useRouter();
  const { isAuthenticated, loading, hasAccess } = useAuth();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (requiredPermission && !hasAccess(requiredPermission)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Access Denied</h1>
          <p className="text-gray-600 mb-6">
            You do not have permission to access this page.
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

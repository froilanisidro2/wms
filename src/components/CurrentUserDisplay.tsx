"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export function CurrentUserDisplay() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleLogout = async () => {
    await logout();
    // Redirect to login
    router.push('/');
  };

  if (!mounted) return null;
  
  const displayName = user?.username || user?.email || 'Guest User';
  
  return (
    <div className="flex items-center gap-4">
      <div className="whitespace-nowrap text-right">
        <div className="text-xs opacity-75">Logged in as:</div>
        <div className="font-semibold text-sm">{displayName}</div>
      </div>
      <button
        onClick={handleLogout}
        className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-sm rounded transition-colors"
      >
        Logout
      </button>
    </div>
  );
}

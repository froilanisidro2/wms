/**
 * Authentication context and hooks for client-side authentication
 * Uses HTTP-Only cookies for secure token storage (no XSS vulnerability)
 */

'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getPostgRESTUrl } from '@/utils/apiUrlBuilder';

interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: 'Admin' | 'Manager' | 'Supervisor' | 'Operator' | 'Viewer';
}

interface UserPermission {
  page_name: string;
  access_level: 'Full Access' | 'Read Only' | 'No Access';
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  permissions: UserPermission[];
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  hasAccess: (pageName: string) => boolean;
  getAccessLevel: (pageName: string) => 'Full Access' | 'Read Only' | 'No Access' | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<UserPermission[]>([]);

  // Verify authentication on mount (check if cookie exists and is valid)
  useEffect(() => {
    const verifyAuth = async () => {
      try {
        console.log('🔐 Calling verify endpoint...');
        const response = await fetch('/api/auth/verify', {
          method: 'GET',
          credentials: 'include', // Include cookies in request
        });

        console.log('✓ Verify endpoint response:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('✓ User verified:', data.user.username);
          console.log('✓ Setting authenticated state: true');
          setUser(data.user);
          setToken(data.token || 'authenticated'); // Token exists in cookie (non-accessible from JS)
          
          // Fetch user permissions from database
          await fetchUserPermissions(data.user.id);
        } else {
          const errorData = await response.json();
          console.log('✗ Verify failed:', errorData);
          console.log('✗ Setting authenticated state: false');
          setUser(null);
          setToken(null);
          setPermissions([]);
        }
      } catch (error) {
        console.error('✗ Verification error:', error);
        console.log('✗ Setting authenticated state: false (error caught)');
        setUser(null);
        setToken(null);
        setPermissions([]);
      }

      setLoading(false);
    };

    verifyAuth();
  }, []);

  const fetchUserPermissions = async (userId: number) => {
    try {
      // Route through /api/config-records instead of direct PostgREST call
      const response = await fetch(`/api/config-records?type=permissions&user_id=${userId}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✓ User permissions loaded:', data);
        setPermissions(data);
      } else {
        console.warn('Failed to fetch user permissions:', response.status);
        setPermissions([]);
      }
    } catch (error) {
      console.error('Error fetching user permissions:', error);
      setPermissions([]);
    }
  };

  const login = async (username: string, password: string, rememberMe: boolean = false) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // Include cookies in request
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    // Token is stored in HTTP-Only cookie automatically by the server
    // We store a marker in memory that we're authenticated
    setToken('authenticated');
    setUser(data.user);

    // Store remembered username in localStorage if checked (non-sensitive)
    if (rememberMe) {
      localStorage.setItem('remembered_username', username);
    } else {
      localStorage.removeItem('remembered_username');
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include', // Include cookies in request so server can clear auth_token
      });
    } catch (error) {
      console.error('Logout request failed:', error);
    }

    // Clear client-side state
    setToken(null);
    setUser(null);
    setPermissions([]);
  };

  const hasAccess = (pageName: string): boolean => {
    // Super Admin (Admin role) has full access to all pages
    if (user?.role === 'Admin') {
      return true;
    }
    
    // For other users, check if they have "Full Access" or "Read Only" to the page
    const permission = permissions.find(p => p.page_name === pageName);
    return permission ? permission.access_level !== 'No Access' : false;
  };

  const getAccessLevel = (pageName: string): 'Full Access' | 'Read Only' | 'No Access' | null => {
    const permission = permissions.find(p => p.page_name === pageName);
    return permission ? permission.access_level : null;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: !!user,
        permissions,
        login,
        logout,
        hasAccess,
        getAccessLevel,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}

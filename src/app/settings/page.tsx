'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const { user, logout, isAuthenticated } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);

  if (!isAuthenticated) {
    return null;
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('All fields are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    if (currentPassword === newPassword) {
      setError('New password must be different from current password');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          currentPassword,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to change password');
        setLoading(false);
        return;
      }

      setSuccess('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordChange(false);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    }

    setLoading(false);
  };

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Settings</h1>

        {/* User Info */}
        <div className="mb-8 pb-8 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Profile Information</h2>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-gray-600">Username:</p>
              <p className="text-gray-900 font-medium">{user?.username}</p>
            </div>
            <div>
              <p className="text-gray-600">Email:</p>
              <p className="text-gray-900 font-medium">{user?.email || 'Not set'}</p>
            </div>
            <div>
              <p className="text-gray-600">Full Name:</p>
              <p className="text-gray-900 font-medium">{user?.full_name || 'Not set'}</p>
            </div>
            <div>
              <p className="text-gray-600">Role:</p>
              <p className="text-gray-900 font-medium">{user?.role}</p>
            </div>
          </div>
        </div>

        {/* Success/Error Messages */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6">
            {success}
          </div>
        )}

        {/* Change Password */}
        <div className="mb-8 pb-8 border-b border-gray-200">
          <button
            onClick={() => setShowPasswordChange(!showPasswordChange)}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg transition duration-200 mb-4"
          >
            {showPasswordChange ? 'Cancel' : 'Change Password'}
          </button>

          {showPasswordChange && (
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label htmlFor="current-password" className="block text-sm font-medium text-gray-700 mb-2">
                  Current Password
                </label>
                <input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-2">
                  New Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition duration-200"
              >
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          )}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg transition duration-200"
        >
          Logout
        </button>
      </div>
    </div>
  );
}

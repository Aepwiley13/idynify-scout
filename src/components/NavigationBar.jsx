// Module 15: Quota Display & Dashboard - NavigationBar Component

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/config';

export default function NavigationBar() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    if (window.confirm('Log out of Mission Control?')) {
      try {
        await signOut(auth);
        navigate('/login');
      } catch (error) {
        console.error('Error logging out:', error);
      }
    }
  };

  const navLinks = [
    { path: '/mission-control', label: 'Dashboard', icon: '🎯' },
    { path: '/companies', label: 'Companies', icon: '🏢' },
    { path: '/scout', label: 'Scout', icon: '🔍' },
    { path: '/lead-review', label: 'Lead Review', icon: '📋' }
  ];

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <nav className="sticky top-0 z-50 bg-black/90 backdrop-blur-md border-b border-cyan-500/30">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo + Barry */}
          <div className="flex items-center gap-3">
            <div
              className="text-4xl cursor-pointer"
              style={{ animation: 'floatBear 6s ease-in-out infinite' }}
              onClick={() => navigate('/mission-control')}
            >
              🐻
            </div>
            <div className="cursor-pointer" onClick={() => navigate('/mission-control')}>
              <h1 className="text-lg font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent font-mono">
                IDYNIFY SCOUT
              </h1>
              <p className="text-xs text-gray-400 font-mono">Barry AI • Mission Control</p>
            </div>
          </div>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-2">
            {navLinks.map((link) => (
              <button
                key={link.path}
                onClick={() => navigate(link.path)}
                className={`px-4 py-2 rounded-lg font-mono text-sm transition-all ${
                  isActive(link.path)
                    ? 'bg-gradient-to-r from-pink-500 to-cyan-500 text-white'
                    : 'text-gray-400 hover:bg-cyan-500/10 hover:text-cyan-300'
                }`}
              >
                {link.icon} {link.label}
              </button>
            ))}
          </div>

          {/* User Menu */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 bg-cyan-500/10 px-3 py-1.5 rounded-lg border border-cyan-500/30">
              <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
              <span className="text-xs font-semibold text-cyan-300 font-mono">
                {auth.currentUser?.email || 'Agent'}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 text-red-300 px-4 py-2 rounded-lg font-mono text-xs transition-all"
            >
              🚪 Logout
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden flex gap-2 pb-3 overflow-x-auto">
          {navLinks.map((link) => (
            <button
              key={link.path}
              onClick={() => navigate(link.path)}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs whitespace-nowrap transition-all ${
                isActive(link.path)
                  ? 'bg-gradient-to-r from-pink-500 to-cyan-500 text-white'
                  : 'text-gray-400 hover:bg-cyan-500/10'
              }`}
            >
              {link.icon} {link.label}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes floatBear {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </nav>
  );
}

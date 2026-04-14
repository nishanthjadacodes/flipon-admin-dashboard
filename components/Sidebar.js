'use client';

import { useState } from 'react';

const menuItems = [
  { id: 'dashboard', label: 'Dashboard Overview', icon: '📊', roles: ['super_admin', 'admin', 'operator'] },
  { id: 'orders', label: 'Order Management', icon: '📋', roles: ['super_admin', 'admin', 'operator'] },
  { id: 'agents', label: 'Agent Management', icon: '👥', roles: ['super_admin', 'admin'] },
  { id: 'services', label: 'Service Management', icon: '⚙️', roles: ['super_admin', 'admin'] },
  { id: 'reports', label: 'Reports & Analytics', icon: '📈', roles: ['super_admin', 'admin'] },
  { id: 'admin', label: 'Admin Controls', icon: '🔐', roles: ['super_admin'] },
];

export default function Sidebar({ activeSection, setActiveSection, notifications, userRole }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const filteredMenuItems = menuItems.filter(item => item.roles.includes(userRole));

  return (
    <aside className={`${isCollapsed ? 'w-20' : 'w-64'} bg-gray-900 text-white transition-all duration-300 ease-in-out flex flex-col`}>
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <h2 className={`font-bold text-xl ${isCollapsed ? 'hidden' : 'block'}`}>
            Admin Panel
          </h2>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-2 rounded hover:bg-gray-800 transition-colors"
          >
            {isCollapsed ? '→' : '←'}
          </button>
        </div>
      </div>

      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {filteredMenuItems.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors ${
                  activeSection === item.id
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-gray-800 text-gray-300'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                {!isCollapsed && (
                  <>
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.id === 'orders' && notifications > 0 && (
                      <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1">
                        {notifications}
                      </span>
                    )}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="p-4 border-t border-gray-800">
        <div className={`flex items-center space-x-3 ${isCollapsed ? 'justify-center' : ''}`}>
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white text-sm font-medium">
              {userRole === 'super_admin' ? 'SA' : userRole === 'admin' ? 'AD' : 'OP'}
            </span>
          </div>
          {!isCollapsed && (
            <div>
              <p className="text-sm font-medium">Admin User</p>
              <p className="text-xs text-gray-400 capitalize">{userRole.replace('_', ' ')}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

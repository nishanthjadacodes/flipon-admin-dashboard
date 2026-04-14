'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import DashboardOverview from '@/components/DashboardOverview';
import OrderManagement from '@/components/OrderManagement';
import AgentManagement from '@/components/AgentManagement';
import ServiceManagement from '@/components/ServiceManagement';
import Reports from '@/components/Reports';
import AdminControls from '@/components/AdminControls';

export default function Home() {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [notifications, setNotifications] = useState(3);
  const [userRole, setUserRole] = useState('super_admin');

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'dashboard':
        return <DashboardOverview notifications={notifications} />;
      case 'orders':
        return <OrderManagement />;
      case 'agents':
        return <AgentManagement />;
      case 'services':
        return <ServiceManagement />;
      case 'reports':
        return <Reports />;
      case 'admin':
        return <AdminControls userRole={userRole} />;
      default:
        return <DashboardOverview notifications={notifications} />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar 
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        notifications={notifications}
        userRole={userRole}
      />
      <main className="flex-1 overflow-y-auto">
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="px-6 py-4 flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">
              {activeSection.charAt(0).toUpperCase() + activeSection.slice(1)} Management
            </h1>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {userRole === 'super_admin' ? 'SA' : 'AD'}
                  </span>
                </div>
                {notifications > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {notifications}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>
        <div className="p-6">
          {renderActiveSection()}
        </div>
      </main>
    </div>
  );
}

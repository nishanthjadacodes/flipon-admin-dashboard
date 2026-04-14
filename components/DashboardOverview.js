'use client';

import { useState, useEffect } from 'react';

export default function DashboardOverview({ notifications }) {
  const [metrics, setMetrics] = useState({
    dailyBookings: 0,
    activeAgents: 0,
    grossRevenue: 0,
    pendingActions: 0,
  });

  const [alerts, setAlerts] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);

  useEffect(() => {
    setMetrics({
      dailyBookings: 127,
      activeAgents: 34,
      grossRevenue: 85420,
      pendingActions: 8,
    });

    setAlerts([
      { id: 1, type: 'warning', message: 'Agent John Smith performance below threshold', time: '2 hours ago' },
      { id: 2, type: 'error', message: 'Service payment processing delayed', time: '4 hours ago' },
      { id: 3, type: 'info', message: 'New agent registration requires approval', time: '6 hours ago' },
    ]);

    setRecentOrders([
      { id: 'ORD-001', customer: 'Alice Johnson', service: 'Home Cleaning', status: 'pending', amount: 150 },
      { id: 'ORD-002', customer: 'Bob Smith', service: 'Plumbing', status: 'in-progress', amount: 280 },
      { id: 'ORD-003', customer: 'Carol White', service: 'Electrical', status: 'completed', amount: 420 },
      { id: 'ORD-004', customer: 'David Brown', service: 'Landscaping', status: 'pending', amount: 350 },
    ]);
  }, []);

  const MetricCard = ({ title, value, icon, trend, color }) => (
    <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {trend && (
            <p className={`text-sm ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% from yesterday
            </p>
          )}
        </div>
        <div className={`text-3xl p-3 rounded-full ${color}`}>
          {icon}
        </div>
      </div>
    </div>
  );

  const AlertItem = ({ alert }) => {
    const alertColors = {
      warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
      error: 'bg-red-50 border-red-200 text-red-800',
      info: 'bg-blue-50 border-blue-200 text-blue-800',
    };

    return (
      <div className={`p-3 rounded-lg border ${alertColors[alert.type]}`}>
        <div className="flex justify-between items-start">
          <p className="text-sm font-medium">{alert.message}</p>
          <span className="text-xs text-gray-500">{alert.time}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-gray-900">Dashboard Overview</h2>
        <div className="flex space-x-2">
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Refresh Data
          </button>
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Export Report
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Daily Bookings"
          value={metrics.dailyBookings}
          icon="📅"
          trend={12}
          color="bg-blue-100"
        />
        <MetricCard
          title="Active Agents"
          value={metrics.activeAgents}
          icon="👤"
          trend={-3}
          color="bg-green-100"
        />
        <MetricCard
          title="Gross Revenue"
          value={`$${metrics.grossRevenue.toLocaleString()}`}
          icon="💰"
          trend={8}
          color="bg-yellow-100"
        />
        <MetricCard
          title="Pending Actions"
          value={metrics.pendingActions}
          icon="⏳"
          trend={15}
          color="bg-red-100"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Operational Alerts</h3>
            <div className="space-y-3">
              {alerts.map((alert) => (
                <AlertItem key={alert.id} alert={alert} />
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Orders</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Order ID</th>
                    <th className="text-left py-2">Customer</th>
                    <th className="text-left py-2">Service</th>
                    <th className="text-left py-2">Status</th>
                    <th className="text-left py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr key={order.id} className="border-b">
                      <td className="py-2 font-medium">{order.id}</td>
                      <td className="py-2">{order.customer}</td>
                      <td className="py-2">{order.service}</td>
                      <td className="py-2">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          order.status === 'completed' ? 'bg-green-100 text-green-800' :
                          order.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="py-2">${order.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="space-y-3">
              <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-left">
                📋 Review Pending Orders ({notifications})
              </button>
              <button className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-left">
                👥 Approve New Agents
              </button>
              <button className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-left">
                💳 Process Payouts
              </button>
              <button className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-left">
                📊 Generate Reports
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance Summary</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Agent Performance</span>
                  <span>87%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-green-600 h-2 rounded-full" style={{ width: '87%' }}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Order Completion</span>
                  <span>92%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full" style={{ width: '92%' }}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Customer Satisfaction</span>
                  <span>94%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-yellow-600 h-2 rounded-full" style={{ width: '94%' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

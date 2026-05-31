import { NavLink } from 'react-router-dom';
import { Monitor, Send, History, Settings, RefreshCw } from 'lucide-react';

const navItems = [
  { path: '/', icon: Monitor, label: '设备发现' },
  { path: '/sync', icon: RefreshCw, label: '文件夹同步' },
  { path: '/transfer', icon: Send, label: '传输队列' },
  { path: '/history', icon: History, label: '传输历史' },
  { path: '/settings', icon: Settings, label: '设置' },
];

export function Sidebar() {
  return (
    <aside className="w-64 h-screen bg-dark-900 border-r border-dark-700 flex flex-col">
      <div className="p-6">
        <h1 className="text-xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <Monitor className="w-6 h-6 text-white" />
          </div>
          LAN Share
        </h1>
        <p className="text-sm text-dark-300 mt-1">局域网文件传输</p>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary text-white shadow-lg shadow-primary/20'
                  : 'text-dark-300 hover:text-white hover:bg-dark-700'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-dark-700">
        <div className="flex items-center gap-3 px-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm text-dark-300">服务运行中</span>
        </div>
      </div>
    </aside>
  );
}

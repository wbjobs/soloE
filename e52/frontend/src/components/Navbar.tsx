import { Link, useLocation } from 'react-router-dom';

export default function Navbar() {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="glass sticky top-0 z-50 mx-4 mt-4 px-6 py-4">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-primary to-success rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-primary to-success bg-clip-text text-transparent">
            P2P CDN
          </span>
        </Link>

        <div className="flex items-center space-x-6">
          <Link
            to="/"
            className={`transition-colors ${isActive('/') ? 'text-primary font-medium' : 'text-gray-300 hover:text-white'}`}
          >
            资源列表
          </Link>
          <Link
            to="/upload"
            className={`transition-colors ${isActive('/upload') ? 'text-primary font-medium' : 'text-gray-300 hover:text-white'}`}
          >
            上传文件
          </Link>
          <Link
            to="/download"
            className={`transition-colors ${isActive('/download') ? 'text-primary font-medium' : 'text-gray-300 hover:text-white'}`}
          >
            下载资源
          </Link>
        </div>
      </div>
    </nav>
  );
}

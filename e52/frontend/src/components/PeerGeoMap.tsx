import { useState, useEffect } from 'react';
import { GeoStats } from '../types';
import { getGeoStats } from '../services/api';

export default function PeerGeoMap() {
  const [stats, setStats] = useState<GeoStats | null>(null);

  useEffect(() => {
    fetchGeoStats();
    const interval = setInterval(fetchGeoStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchGeoStats = async () => {
    try {
      const data = await getGeoStats(50);
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch geo stats:', error);
    }
  };

  const getRegionColor = (region: string): string => {
    const colors: Record<string, string> = {
      'Asia': '#3B82F6',
      'Europe': '#10B981',
      'North America': '#F59E0B',
      'South America': '#8B5CF6',
      'Africa': '#EC4899',
      'Oceania': '#06B6D4',
    };
    return colors[region] || '#6B7280';
  };

  const getCountryFlag = (country: string): string => {
    const flags: Record<string, string> = {
      'China': '🇨🇳',
      'United States': '🇺🇸',
      'Japan': '🇯🇵',
      'Germany': '🇩🇪',
      'United Kingdom': '🇬🇧',
      'South Korea': '🇰🇷',
      'Australia': '🇦🇺',
      'Russia': '🇷🇺',
      'India': '🇮🇳',
      'Brazil': '🇧🇷',
      'Canada': '🇨🇦',
      'France': '🇫🇷',
    };
    return flags[country] || '🌍';
  };

  if (!stats) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4" />
          <div className="h-48 bg-gray-200 rounded mb-4" />
          <div className="h-24 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  const sortedCountries = Object.entries(stats.byCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const sortedRegions = Object.entries(stats.byRegion)
    .sort((a, b) => b[1] - a[1]);

  const totalPeers = Object.values(stats.byCountry).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-6">节点地理分布</h2>

      <div className="mb-6">
        <div className="text-4xl font-bold text-center text-blue-600 mb-2">
          {totalPeers}
        </div>
        <div className="text-center text-gray-500 text-sm">活跃节点数</div>
      </div>

      <div className="mb-6">
        <h3 className="font-semibold text-gray-700 mb-3">按地区分布</h3>
        <div className="flex flex-wrap gap-2">
          {sortedRegions.map(([region, count]) => (
            <div
              key={region}
              className="flex items-center px-3 py-1.5 rounded-lg text-white text-sm"
              style={{ backgroundColor: getRegionColor(region) }}
            >
              <span className="mr-2">{region}</span>
              <span className="font-bold">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-gray-700 mb-3">按国家分布</h3>
        <div className="space-y-2">
          {sortedCountries.map(([country, count]) => {
            const percentage = (count / totalPeers) * 100;
            return (
              <div key={country} className="flex items-center">
                <span className="w-8 text-xl">{getCountryFlag(country)}</span>
                <span className="w-24 text-sm text-gray-700 truncate">{country}</span>
                <div className="flex-1 mx-3">
                  <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
                <span className="w-16 text-right text-sm font-medium text-gray-600">
                  {count} 节点
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 pt-4 border-t">
        <h3 className="font-semibold text-gray-700 mb-3">简易世界地图</h3>
        <div className="relative bg-blue-50 rounded-lg p-4 h-48">
          <svg viewBox="0 0 200 100" className="w-full h-full">
            <rect fill="none" stroke="#E5E7EB" strokeWidth="0.5" width="200" height="100" />
            
            <ellipse cx="100" cy="50" rx="85" ry="40" fill="none" stroke="#E5E7EB" strokeWidth="0.5" />
            
            <ellipse cx="35" cy="35" rx="18" ry="12" fill="#D1FAE5" stroke="#6EE7B7" strokeWidth="0.5" />
            <ellipse cx="95" cy="35" rx="8" ry="10" fill="#D1FAE5" stroke="#6EE7B7" strokeWidth="0.5" />
            <ellipse cx="145" cy="40" rx="20" ry="15" fill="#D1FAE5" stroke="#6EE7B7" strokeWidth="0.5" />
            <ellipse cx="170" cy="70" rx="12" ry="10" fill="#D1FAE5" stroke="#6EE7B7" strokeWidth="0.5" />
            <ellipse cx="55" cy="65" rx="10" ry="12" fill="#D1FAE5" stroke="#6EE7B7" strokeWidth="0.5" />
            <ellipse cx="120" cy="65" rx="15" ry="12" fill="#D1FAE5" stroke="#6EE7B7" strokeWidth="0.5" />

            {sortedCountries.slice(0, 5).map(([country, count]) => {
              const positions: Record<string, { x: number; y: number }> = {
                'China': { x: 110, y: 40 },
                'United States': { x: 35, y: 45 },
                'Japan': { x: 125, y: 38 },
                'Germany': { x: 92, y: 33 },
                'United Kingdom': { x: 88, y: 30 },
                'South Korea': { x: 118, y: 40 },
                'Australia': { x: 165, y: 75 },
                'Russia': { x: 100, y: 25 },
              };
              const pos = positions[country] || { x: 100, y: 50 };
              const size = Math.min(6, 2 + count * 0.3);
              return (
                <circle
                  key={country}
                  cx={pos.x}
                  cy={pos.y}
                  r={size}
                  fill="#3B82F6"
                  fillOpacity={0.7}
                  className="animate-pulse"
                >
                  <title>{country}: {count} 节点</title>
                </circle>
              );
            })}
          </svg>
          
          <div className="absolute bottom-2 right-2 flex flex-wrap gap-2 text-xs">
            {sortedRegions.map(([region]) => (
              <div key={region} className="flex items-center">
                <span
                  className="w-2 h-2 rounded-full mr-1"
                  style={{ backgroundColor: getRegionColor(region) }}
                />
                <span className="text-gray-600">{region}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

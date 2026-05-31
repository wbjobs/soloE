import React from 'react';
import { MoleculeData } from '../types';

interface MoleculeStatsProps {
  data: MoleculeData | null;
}

const MoleculeStats: React.FC<MoleculeStatsProps> = ({ data }) => {
  if (!data) {
    return null;
  }

  const elementCounts = data.atoms.reduce((acc, atom) => {
    acc[atom.element] = (acc[atom.element] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <h3 className="text-lg font-semibold text-white mb-3">分子统计</h3>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-700 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-cyan-400">{data.atoms.length}</div>
          <div className="text-slate-400 text-xs">原子</div>
        </div>
        <div className="bg-slate-700 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-emerald-400">{data.bonds.length}</div>
          <div className="text-slate-400 text-xs">化学键</div>
        </div>
      </div>
      <div>
        <div className="text-slate-400 text-sm mb-2">元素组成</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(elementCounts).map(([element, count]) => (
            <span
              key={element}
              className="px-2 py-1 bg-slate-700 rounded text-xs text-slate-300"
            >
              {element}: {count}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MoleculeStats;

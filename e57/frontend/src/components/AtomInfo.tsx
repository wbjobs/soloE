import React from 'react';
import { Atom } from '../types';
import { getElementColor } from '../utils/colors';

interface AtomInfoProps {
  atom: Atom | null;
}

const AtomInfo: React.FC<AtomInfoProps> = ({ atom }) => {
  if (!atom) {
    return (
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h3 className="text-lg font-semibold text-white mb-3">原子信息</h3>
        <p className="text-slate-400 text-sm">点击原子查看详细信息</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <h3 className="text-lg font-semibold text-white mb-3">原子信息</h3>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg"
            style={{ backgroundColor: getElementColor(atom.element) }}
          >
            {atom.element}
          </div>
          <div>
            <div className="text-white font-medium">{atom.element} - {atom.name}</div>
            <div className="text-slate-400 text-sm">原子 ID: {atom.id}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="bg-slate-700 rounded-lg p-2 text-center">
            <div className="text-slate-400 text-xs">X</div>
            <div className="text-white font-mono">{atom.x.toFixed(3)}</div>
          </div>
          <div className="bg-slate-700 rounded-lg p-2 text-center">
            <div className="text-slate-400 text-xs">Y</div>
            <div className="text-white font-mono">{atom.y.toFixed(3)}</div>
          </div>
          <div className="bg-slate-700 rounded-lg p-2 text-center">
            <div className="text-slate-400 text-xs">Z</div>
            <div className="text-white font-mono">{atom.z.toFixed(3)}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AtomInfo;

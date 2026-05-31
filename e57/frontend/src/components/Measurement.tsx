import React from 'react';
import { MeasurementState } from '../types';
import { getElementColor } from '../utils/colors';

interface MeasurementProps {
  measurement: MeasurementState;
  isMeasuring: boolean;
  onReset: () => void;
}

const Measurement: React.FC<MeasurementProps> = ({ measurement, isMeasuring, onReset }) => {
  if (!isMeasuring) {
    return null;
  }

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">距离测量</h3>
        <button
          onClick={onReset}
          className="text-slate-400 hover:text-white transition-colors text-sm"
        >
          重置
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs ${
            measurement.firstAtom ? '' : 'opacity-30'
          }`} style={{ backgroundColor: measurement.firstAtom ? getElementColor(measurement.firstAtom.element) : '#475569' }}>
            1
          </div>
          <div className="text-slate-300 text-sm">
            {measurement.firstAtom 
              ? `${measurement.firstAtom.element} - ${measurement.firstAtom.name}`
              : '点击选择第一个原子'}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs ${
            measurement.secondAtom ? '' : 'opacity-30'
          }`} style={{ backgroundColor: measurement.secondAtom ? getElementColor(measurement.secondAtom.element) : '#475569' }}>
            2
          </div>
          <div className="text-slate-300 text-sm">
            {measurement.secondAtom 
              ? `${measurement.secondAtom.element} - ${measurement.secondAtom.name}`
              : '点击选择第二个原子'}
          </div>
        </div>

        {measurement.distance !== null && (
          <div className="mt-4 p-3 bg-cyan-900/30 rounded-lg border border-cyan-700/50">
            <div className="text-cyan-400 text-xs mb-1">距离</div>
            <div className="text-2xl font-bold text-white">
              {measurement.distance.toFixed(3)} <span className="text-sm text-cyan-300">Å</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Measurement;

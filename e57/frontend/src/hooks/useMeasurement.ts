import { useState, useCallback } from 'react';
import { Atom, MeasurementState } from '../types';

export const useMeasurement = () => {
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurement, setMeasurement] = useState<MeasurementState>({
    firstAtom: null,
    secondAtom: null,
    distance: null
  });

  const calculateDistance = useCallback((atom1: Atom, atom2: Atom): number => {
    const dx = atom2.x - atom1.x;
    const dy = atom2.y - atom1.y;
    const dz = atom2.z - atom1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }, []);

  const handleAtomClick = useCallback((atom: Atom) => {
    if (!isMeasuring) return;

    setMeasurement(prev => {
      if (!prev.firstAtom) {
        return {
          firstAtom: atom,
          secondAtom: null,
          distance: null
        };
      } else if (!prev.secondAtom) {
        const distance = calculateDistance(prev.firstAtom, atom);
        return {
          firstAtom: prev.firstAtom,
          secondAtom: atom,
          distance
        };
      } else {
        return {
          firstAtom: atom,
          secondAtom: null,
          distance: null
        };
      }
    });
  }, [isMeasuring, calculateDistance]);

  const resetMeasurement = useCallback(() => {
    setMeasurement({
      firstAtom: null,
      secondAtom: null,
      distance: null
    });
  }, []);

  const toggleMeasuring = useCallback(() => {
    setIsMeasuring(prev => !prev);
    if (isMeasuring) {
      resetMeasurement();
    }
  }, [isMeasuring, resetMeasurement]);

  return {
    isMeasuring,
    measurement,
    handleAtomClick,
    resetMeasurement,
    toggleMeasuring
  };
};

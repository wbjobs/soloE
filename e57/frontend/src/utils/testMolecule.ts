import { MoleculeData } from '../types';

export function generateLargeMolecule(atomCount: number): MoleculeData {
  const atoms: MoleculeData['atoms'] = [];
  const bonds: MoleculeData['bonds'] = [];
  const elements = ['C', 'H', 'O', 'N', 'S', 'P'];

  for (let i = 0; i < atomCount; i++) {
    const angle = (i / atomCount) * Math.PI * 20;
    const radius = 5 + (i / atomCount) * 20;
    const height = (Math.random() - 0.5) * 10;

    atoms.push({
      id: i,
      element: elements[Math.floor(Math.random() * elements.length)],
      name: `${elements[Math.floor(Math.random() * elements.length)]}${i}`,
      x: Math.cos(angle) * radius + (Math.random() - 0.5) * 2,
      y: Math.sin(angle) * radius + (Math.random() - 0.5) * 2,
      z: height + (Math.random() - 0.5) * 2
    });
  }

  for (let i = 0; i < atomCount - 1; i++) {
    if (Math.random() > 0.3) {
      bonds.push({
        atom1: i,
        atom2: i + 1
      });
    }
    if (Math.random() > 0.7 && i + 2 < atomCount) {
      bonds.push({
        atom1: i,
        atom2: i + 2
      });
    }
  }

  return { atoms, bonds };
}

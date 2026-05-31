export interface Atom {
  id: number;
  element: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface Bond {
  atom1: number;
  atom2: number;
}

export interface MoleculeData {
  atoms: Atom[];
  bonds: Bond[];
}

export interface MeasurementState {
  firstAtom: Atom | null;
  secondAtom: Atom | null;
  distance: number | null;
}

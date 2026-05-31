export const elementColors: Record<string, string> = {
  'C': '#444444',
  'H': '#ffffff',
  'O': '#ff4444',
  'N': '#4444ff',
  'S': '#ffff44',
  'P': '#ffa500',
  'F': '#00ff00',
  'Cl': '#00ff00',
  'Br': '#8b0000',
  'I': '#940094',
  'Fe': '#ffa500',
  'Ca': '#808080',
  'Na': '#ab5cf2',
  'Mg': '#8aff00',
  'Zn': '#7c8089',
  'Cu': '#c88033',
  'Mn': '#9c7ac7',
  'Ni': '#50d050',
  'Co': '#f090a0',
  'Ag': '#c0c0c0',
  'Au': '#ffd123',
  'Hg': '#b8b8d0',
  'default': '#ff00ff'
};

export const getElementColor = (element: string): string => {
  return elementColors[element] || elementColors['default'];
};

export const elementRadius: Record<string, number> = {
  'H': 0.25,
  'C': 0.35,
  'N': 0.32,
  'O': 0.30,
  'F': 0.28,
  'P': 0.38,
  'S': 0.36,
  'Cl': 0.34,
  'default': 0.35
};

export const getElementRadius = (element: string): number => {
  return elementRadius[element] || elementRadius['default'];
};

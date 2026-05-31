import numpy as np
from Bio.PDB import PDBParser
import os

def calculate_distance(coord1, coord2):
    return np.linalg.norm(np.array(coord1) - np.array(coord2))

def parse_pdb_file(file_path):
    parser = PDBParser(QUIET=True)
    structure = parser.get_structure('molecule', file_path)
    
    atoms = []
    atom_id_map = {}
    atom_coords = []
    
    atom_index = 0
    for model in structure:
        for chain in model:
            for residue in chain:
                for atom in residue:
                    atom_data = {
                        'id': atom_index,
                        'element': atom.element,
                        'name': atom.name,
                        'x': float(atom.coord[0]),
                        'y': float(atom.coord[1]),
                        'z': float(atom.coord[2])
                    }
                    atoms.append(atom_data)
                    atom_id_map[atom.get_serial_number()] = atom_index
                    atom_coords.append(atom.coord)
                    atom_index += 1
    
    bonds = []
    coords_array = np.array(atom_coords)
    bond_threshold = 1.8
    
    for i in range(len(atoms)):
        for j in range(i + 1, len(atoms)):
            dist = calculate_distance(coords_array[i], coords_array[j])
            if dist < bond_threshold:
                bonds.append({'atom1': i, 'atom2': j})
    
    return {
        'atoms': atoms,
        'bonds': bonds
    }

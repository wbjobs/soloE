from typing import List, Dict, Any

MOLECULE_LIBRARY: List[Dict[str, Any]] = [
    {"smiles": "CCO", "name": "Ethanol", "logp": -0.14, "source": "PubChem"},
    {"smiles": "CC(=O)O", "name": "Acetic acid", "logp": -0.17, "source": "PubChem"},
    {"smiles": "c1ccccc1", "name": "Benzene", "logp": 2.13, "source": "PubChem"},
    {"smiles": "CC(C)C(=O)OC1=CC=CC=C1C(=O)O", "name": "Aspirin", "logp": 1.19, "source": "PubChem"},
    {"smiles": "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", "name": "Caffeine", "logp": -0.07, "source": "PubChem"},
    {"smiles": "C1CCCCC1", "name": "Cyclohexane", "logp": 3.44, "source": "PubChem"},
    {"smiles": "CC(C)O", "name": "Isopropanol", "logp": 0.05, "source": "PubChem"},
    {"smiles": "CC(CC)C", "name": "Pentane", "logp": 3.39, "source": "PubChem"},
    {"smiles": "CC1=CC=C(C=C1)C(=O)O", "name": "p-Toluic acid", "logp": 2.37, "source": "PubChem"},
    {"smiles": "CC(=O)OC(C)(C)C", "name": "tert-Butyl acetate", "logp": 1.80, "source": "PubChem"},
    {"smiles": "C1=CC=C(C=C1)O", "name": "Phenol", "logp": 1.46, "source": "PubChem"},
    {"smiles": "C(C(=O)O)N", "name": "Glycine", "logp": -3.21, "source": "PubChem"},
    {"smiles": "CC1=CC=CC=C1", "name": "Toluene", "logp": 2.73, "source": "PubChem"},
    {"smiles": "C1=CC(=CC=C1N)N", "name": "o-Phenylenediamine", "logp": 0.22, "source": "PubChem"},
    {"smiles": "CC(=O)N(C)C", "name": "N,N-Dimethylacetamide", "logp": -0.77, "source": "PubChem"},
    {"smiles": "C1COCC1", "name": "1,4-Dioxane", "logp": -0.27, "source": "PubChem"},
    {"smiles": "CC(C)(C)O", "name": "tert-Butanol", "logp": 0.35, "source": "PubChem"},
    {"smiles": "C1=CC=C2C(=C1)C(=O)C3=CC=CC=C3C2=O", "name": "Anthraquinone", "logp": 3.43, "source": "PubChem"},
    {"smiles": "CC12CCC3C(C1CCC2O)CCC4=CC(=O)CCC34C", "name": "Testosterone", "logp": 3.32, "source": "PubChem"},
    {"smiles": "C1=CC(=C(C=C1Cl)O)Cl", "name": "2,4-Dichlorophenol", "logp": 3.06, "source": "PubChem"},
    {"smiles": "CCN(CC)CC", "name": "Triethylamine", "logp": 1.45, "source": "PubChem"},
    {"smiles": "C1=CC(=CC=C1C(=O)O)O", "name": "Salicylic acid", "logp": 2.02, "source": "PubChem"},
    {"smiles": "CC(=O)OCC", "name": "Ethyl acetate", "logp": 0.73, "source": "PubChem"},
    {"smiles": "C1CCC(CC1)N", "name": "Cyclohexanamine", "logp": 1.54, "source": "PubChem"},
    {"smiles": "CC1=CC=C(C=C1)N", "name": "p-Toluidine", "logp": 1.39, "source": "PubChem"},
    {"smiles": "C1=CC=C(C=C1)C(=O)N", "name": "Benzamide", "logp": 0.84, "source": "PubChem"},
    {"smiles": "CCOC(=O)CC", "name": "Ethyl propionate", "logp": 1.33, "source": "PubChem"},
    {"smiles": "CC(C)C1=CC=CC=C1", "name": "Cumene", "logp": 3.68, "source": "PubChem"},
    {"smiles": "C1=CC=C2C(=C1)N=CN2", "name": "Benzimidazole", "logp": 1.32, "source": "PubChem"},
    {"smiles": "CC(=O)NC1=CC=C(C=C1)O", "name": "Acetaminophen", "logp": 0.49, "source": "PubChem"},
    {"smiles": "C1=CC(=C(C=C1)N)N", "name": "m-Phenylenediamine", "logp": -0.23, "source": "PubChem"},
    {"smiles": "CC(=O)C", "name": "Acetone", "logp": -0.24, "source": "PubChem"},
    {"smiles": "CC1=CNC=N1", "name": "2-Methylimidazole", "logp": 0.18, "source": "PubChem"},
    {"smiles": "C1=CC=C(C=C1)S(=O)(=O)N", "name": "Benzenesulfonamide", "logp": 0.30, "source": "PubChem"},
    {"smiles": "CC(=O)OC1=CC=CC=C1", "name": "Phenyl acetate", "logp": 1.16, "source": "PubChem"},
    {"smiles": "C1=CC=C2C(=C1)C=CC(=O)O2", "name": "Coumarin", "logp": 1.39, "source": "PubChem"},
    {"smiles": "CC(=O)N1C=CC(=O)N(C1=O)C", "name": "5-Fluorouracil", "logp": -0.73, "source": "PubChem"},
    {"smiles": "C1=CC(=C(C=C1)O)O", "name": "Catechol", "logp": 0.88, "source": "PubChem"},
    {"smiles": "CC(C)CC1=CC=C(C=C1)C(=O)O", "name": "Ibuprofen", "logp": 3.97, "source": "PubChem"},
    {"smiles": "CC(=O)N(C1=CC=CC=C1)C", "name": "N-Phenylacetamide", "logp": 0.73, "source": "PubChem"},
    {"smiles": "C1=CC=C(C=C1)C#N", "name": "Benzonitrile", "logp": 1.56, "source": "PubChem"},
    {"smiles": "C1COCCO1", "name": "1,4-Dioxane", "logp": -0.27, "source": "PubChem"},
    {"smiles": "CC(=O)OC(C)C", "name": "Isopropyl acetate", "logp": 1.12, "source": "PubChem"},
    {"smiles": "C1=CC=C(C=C1)P(=O)(O)O", "name": "Phenylphosphonic acid", "logp": 0.36, "source": "PubChem"},
    {"smiles": "CC1=CC=C(C=C1)S(=O)(=O)OH", "name": "p-Toluenesulfonic acid", "logp": 0.74, "source": "PubChem"},
    {"smiles": "C1=CC=C2C(=C1)NC(=O)C=C2", "name": "Quinolone", "logp": 1.77, "source": "PubChem"},
    {"smiles": "CC(C)N(C)C(=O)C1=CC=CC=C1", "name": "N-Methyl-N-isopropylbenzamide", "logp": 2.48, "source": "PubChem"},
    {"smiles": "C1=CC(=C(C=C1Cl)Cl)O", "name": "2,4-Dichlorophenol", "logp": 3.06, "source": "PubChem"},
    {"smiles": "CC(=O)OCC1=CC=CC=C1", "name": "Benzyl acetate", "logp": 1.58, "source": "PubChem"},
    {"smiles": "C1=CN=CC=N1", "name": "Pyrazine", "logp": 0.30, "source": "PubChem"},
]


def get_library() -> List[Dict[str, Any]]:
    return MOLECULE_LIBRARY


def get_smiles_list() -> List[str]:
    return [mol["smiles"] for mol in MOLECULE_LIBRARY]


def get_molecule_by_index(index: int) -> Dict[str, Any]:
    if 0 <= index < len(MOLECULE_LIBRARY):
        return MOLECULE_LIBRARY[index]
    return {}


def get_library_size() -> int:
    return len(MOLECULE_LIBRARY)

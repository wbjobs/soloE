from io import BytesIO
from typing import Optional, Tuple
import numpy as np

try:
    from rdkit import Chem
    from rdkit.Chem import AllChem, Draw
    from rdkit.Chem.Draw import rdMolDraw2D
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False


def validate_smiles(smiles: str) -> bool:
    if not RDKIT_AVAILABLE:
        return _simple_smiles_validation(smiles)
    try:
        mol = Chem.MolFromSmiles(smiles)
        return mol is not None
    except Exception:
        return False


def _simple_smiles_validation(smiles: str) -> bool:
    if not isinstance(smiles, str) or len(smiles) == 0:
        return False
    allowed_chars = set("CNOPSFIcnopsfH0123456789()[]=-+#@/\\.%*")
    for char in smiles:
        if char.isspace():
            return False
        if char not in allowed_chars:
            return False
    has_atom = any(c in "CNOPSFIcnopsf" for c in smiles)
    return len(smiles) >= 2 and has_atom


def get_molecule_image(smiles: str, size: Tuple[int, int] = (400, 300)) -> Optional[bytes]:
    if not RDKIT_AVAILABLE:
        return None
    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        mol = Chem.AddHs(mol)
        AllChem.Compute2DCoords(mol)
        drawer = rdMolDraw2D.MolDraw2DCairo(size[0], size[1])
        drawer.DrawMolecule(mol)
        drawer.FinishDrawing()
        img_data = drawer.GetDrawingText()
        return img_data
    except Exception:
        return None


def get_molecule_svg(smiles: str, size: Tuple[int, int] = (400, 300)) -> Optional[str]:
    if not RDKIT_AVAILABLE:
        return None
    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        mol = Chem.AddHs(mol)
        AllChem.Compute2DCoords(mol)
        drawer = rdMolDraw2D.MolDraw2DSVG(size[0], size[1])
        drawer.DrawMolecule(mol)
        drawer.FinishDrawing()
        svg_data = drawer.GetDrawingText()
        return svg_data
    except Exception:
        return None


def get_molecular_features(smiles: str) -> Optional[np.ndarray]:
    if not RDKIT_AVAILABLE:
        return np.random.rand(2048).astype(np.float32)
    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        fp = AllChem.GetMorganFingerprintAsBitVect(mol, 2, nBits=2048)
        arr = np.zeros((1,), dtype=np.float32)
        Chem.DataStructs.ConvertToNumpyArray(fp, arr)
        return arr
    except Exception:
        return None


def smiles_to_mock_graph(smiles: str) -> dict:
    features = get_molecular_features(smiles)
    if features is None:
        features = np.random.rand(2048).astype(np.float32)
    return {"features": features.tolist(), "num_atoms": len(smiles)}

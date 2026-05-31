import express, { type Request, type Response } from 'express';
import { saveMatrix, getMatrix, listMatrices, deleteMatrix, listHistory, saveHistory } from '../db.js';

const router = express.Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const matrices = await listMatrices();
    res.json({
      success: true,
      data: matrices,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to list matrices',
    });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const matrix = await getMatrix(req.params.id);
    if (!matrix) {
      return res.status(404).json({
        success: false,
        error: 'Matrix not found',
      });
    }

    res.json({
      success: true,
      data: {
        id: matrix.id,
        name: matrix.name,
        rows: matrix.rows,
        cols: matrix.cols,
        nnz: matrix.nnz,
        density: matrix.density,
        indptr: Array.from(matrix.indptr),
        indices: Array.from(matrix.indices),
        data: Array.from(matrix.data),
        created_at: matrix.created_at,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get matrix',
    });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, rows, cols, nnz, density, indptr, indices, data } = req.body;

    if (!name || !rows || !cols || !indptr || !indices || !data) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const id = Date.now().toString();

    await saveMatrix({
      id,
      name,
      rows,
      cols,
      nnz: nnz || data.length,
      density: density || data.length / (rows * cols),
      indptr: new Uint32Array(indptr),
      indices: new Uint32Array(indices),
      data: new Float64Array(data),
    });

    res.json({
      success: true,
      data: { id },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to save matrix',
    });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteMatrix(req.params.id);
    res.json({
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to delete matrix',
    });
  }
});

// 历史记录路由
router.get('/history', async (req: Request, res: Response) => {
  try {
    const history = await listHistory();
    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to list history',
    });
  }
});

router.post('/history', async (req: Request, res: Response) => {
  try {
    const { matrixAId, matrixBId, resultId, engine, duration, memoryPeak } = req.body;

    if (!matrixAId || !matrixBId || !resultId || !engine) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    const id = Date.now().toString();

    await saveHistory({
      id,
      matrix_a_id: matrixAId,
      matrix_b_id: matrixBId,
      result_id: resultId,
      engine,
      duration: duration || 0,
      memory_peak: memoryPeak || 0,
    });

    res.json({
      success: true,
      data: { id },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to save history',
    });
  }
});

export default router;

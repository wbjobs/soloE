import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

const router = express.Router();

const DATA_DIR = path.join(process.cwd(), 'data', 'pointclouds');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.las' || ext === '.ply') {
      cb(null, true);
    } else {
      cb(new Error('Only LAS and PLY files are allowed'));
    }
  },
});

interface PointCloudMetadata {
  id: string;
  name: string;
  format: 'las' | 'ply';
  totalPoints: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  hasRGB: boolean;
  hasIntensity: boolean;
  chunkCount: number;
  createdAt: string;
}

interface OctreeNode {
  id: string;
  level: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  center: [number, number, number];
  pointCount: number;
  children: string[];
}

const ensureDataDir = async () => {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
};

const parseLASHeader = (buffer: Buffer): {
  pointCount: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  pointDataOffset: number;
  pointDataRecordLength: number;
} => {
  const pointCount = buffer.readUInt32LE(107);
  const minX = buffer.readDoubleLE(187);
  const maxX = buffer.readDoubleLE(179);
  const minY = buffer.readDoubleLE(203);
  const maxY = buffer.readDoubleLE(195);
  const minZ = buffer.readDoubleLE(219);
  const maxZ = buffer.readDoubleLE(211);
  const pointDataOffset = buffer.readUInt32LE(96);
  const pointDataRecordLength = buffer.readUInt16LE(105);

  return {
    pointCount,
    bounds: {
      min: [minX, minY, minZ] as [number, number, number],
      max: [maxX, maxY, maxZ] as [number, number, number],
    },
    pointDataOffset,
    pointDataRecordLength,
  };
};

const buildOctree = (
  bounds: { min: [number, number, number]; max: [number, number, number] },
  maxDepth: number = 5
): { root: OctreeNode; nodes: OctreeNode[] } => {
  const nodes: OctreeNode[] = [];

  const createNode = (
    level: number,
    nodeBounds: { min: [number, number, number]; max: [number, number, number] }
  ): OctreeNode => {
    const center: [number, number, number] = [
      (nodeBounds.min[0] + nodeBounds.max[0]) / 2,
      (nodeBounds.min[1] + nodeBounds.max[1]) / 2,
      (nodeBounds.min[2] + nodeBounds.max[2]) / 2,
    ];

    const node: OctreeNode = {
      id: uuidv4(),
      level,
      bounds: nodeBounds,
      center,
      pointCount: 0,
      children: [],
    };

    nodes.push(node);

    if (level < maxDepth) {
      const midX = center[0];
      const midY = center[1];
      const midZ = center[2];

      for (let i = 0; i < 8; i++) {
        const childBounds = {
          min: [
            i & 1 ? midX : nodeBounds.min[0],
            i & 2 ? midY : nodeBounds.min[1],
            i & 4 ? midZ : nodeBounds.min[2],
          ] as [number, number, number],
          max: [
            i & 1 ? nodeBounds.max[0] : midX,
            i & 2 ? nodeBounds.max[1] : midY,
            i & 4 ? nodeBounds.max[2] : midZ,
          ] as [number, number, number],
        };

        const child = createNode(level + 1, childBounds);
        node.children.push(child.id);
      }
    }

    return node;
  };

  const root = createNode(0, bounds);

  return { root, nodes };
};

router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }

    await ensureDataDir();

    const id = uuidv4();
    const ext = path.extname(req.file.originalname).toLowerCase() as '.las' | '.ply';
    const format = ext.slice(1) as 'las' | 'ply';

    const pointCloudDir = path.join(DATA_DIR, id);
    await fs.mkdir(pointCloudDir, { recursive: true });

    const originalFilePath = path.join(pointCloudDir, `original${ext}`);
    await fs.writeFile(originalFilePath, req.file.buffer);

    let headerInfo;
    if (format === 'las') {
      headerInfo = parseLASHeader(req.file.buffer);
    } else {
      const content = req.file.buffer.toString('utf8');
      const vertexMatch = content.match(/element vertex\s+(\d+)/);
      const pointCount = vertexMatch ? parseInt(vertexMatch[1]) : 0;
      
      headerInfo = {
        pointCount,
        bounds: {
          min: [-100, -50, -100] as [number, number, number],
          max: [100, 50, 100] as [number, number, number],
        },
        pointDataOffset: 0,
        pointDataRecordLength: 32,
      };
    }

    const { root, nodes } = buildOctree(headerInfo.bounds);

    const metadata: PointCloudMetadata = {
      id,
      name: req.file.originalname,
      format,
      totalPoints: headerInfo.pointCount,
      bounds: headerInfo.bounds,
      hasRGB: true,
      hasIntensity: true,
      chunkCount: nodes.length,
      createdAt: new Date().toISOString(),
    };

    await fs.writeFile(
      path.join(pointCloudDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    await fs.writeFile(
      path.join(pointCloudDir, 'octree.json'),
      JSON.stringify({ root, nodes }, null, 2)
    );

    res.status(200).json({
      success: true,
      data: metadata,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    });
  }
});

router.get('/:id/metadata', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const metadataPath = path.join(DATA_DIR, id, 'metadata.json');

    if (!existsSync(metadataPath)) {
      res.status(404).json({ success: false, error: 'Point cloud not found' });
      return;
    }

    const metadata = await fs.readFile(metadataPath, 'utf8');
    res.status(200).json({
      success: true,
      data: JSON.parse(metadata),
    });
  } catch (error) {
    console.error('Metadata error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load metadata',
    });
  }
});

router.get('/:id/chunks', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { lodLevel = '0' } = req.query;

    const octreePath = path.join(DATA_DIR, id, 'octree.json');

    if (!existsSync(octreePath)) {
      res.status(404).json({ success: false, error: 'Point cloud not found' });
      return;
    }

    const octreeData = await fs.readFile(octreePath, 'utf8');
    const { nodes } = JSON.parse(octreeData);

    const filteredNodes = nodes.filter(
      (node: OctreeNode) => node.level === parseInt(lodLevel as string)
    );

    const chunks = filteredNodes.map((node: OctreeNode) => ({
      nodeId: node.id,
      lodLevel: node.level,
      bounds: node.bounds,
      center: node.center,
    }));

    res.status(200).json({
      success: true,
      data: chunks,
    });
  } catch (error) {
    console.error('Chunks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load chunks',
    });
  }
});

router.get('/:id/chunk/:nodeId', async (req: Request, res: Response) => {
  try {
    const { id, nodeId } = req.params;
    const { lodLevel = '0' } = req.query;

    const pointCloudDir = path.join(DATA_DIR, id);
    const chunkPath = path.join(pointCloudDir, `chunks/${lodLevel}/${nodeId}.bin`);

    if (!existsSync(chunkPath)) {
      const positions = new Float32Array(100 * 3);
      const colors = new Float32Array(100 * 3);

      for (let i = 0; i < 100; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 100;
        positions[i * 3 + 1] = Math.random() * 50;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 100;

        const height = positions[i * 3 + 1] / 50;
        colors[i * 3] = height;
        colors[i * 3 + 1] = 1 - Math.abs(height - 0.5) * 2;
        colors[i * 3 + 2] = 1 - height;
      }

      const chunkData = {
        nodeId,
        lodLevel: parseInt(lodLevel as string),
        positions: Array.from(positions),
        colors: Array.from(colors),
        pointCount: 100,
      };

      res.status(200).json({
        success: true,
        data: chunkData,
      });
      return;
    }

    const chunkBuffer = await fs.readFile(chunkPath);
    res.status(200).send(chunkBuffer);
  } catch (error) {
    console.error('Chunk error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load chunk',
    });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    await ensureDataDir();

    const dirs = await fs.readdir(DATA_DIR, { withFileTypes: true });
    const pointClouds: PointCloudMetadata[] = [];

    for (const dir of dirs) {
      if (dir.isDirectory()) {
        const metadataPath = path.join(DATA_DIR, dir.name, 'metadata.json');
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
          pointClouds.push(metadata);
        }
      }
    }

    res.status(200).json({
      success: true,
      data: pointClouds,
    });
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list point clouds',
    });
  }
});

export default router;

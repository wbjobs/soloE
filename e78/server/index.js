const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ModelLoader = require('./modelLoader');
const DiffCalculator = require('./diffCalculator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.obj', '.gltf', '.glb'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 OBJ, GLTF, GLB 格式文件'));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

const activeProgressClients = new Map();

wss.on('connection', (ws, req) => {
  const clientId = req.headers['sec-websocket-key'] || Date.now().toString();
  activeProgressClients.set(clientId, ws);
  console.log(`WebSocket 客户端已连接: ${clientId}, 当前连接数: ${activeProgressClients.size}`);

  ws.send(JSON.stringify({
    type: 'connected',
    message: '已连接到进度通知服务',
    clientId
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('收到 WebSocket 消息:', data);
    } catch (e) {
      console.error('解析 WebSocket 消息失败:', e);
    }
  });

  ws.on('close', () => {
    activeProgressClients.delete(clientId);
    console.log(`WebSocket 客户端已断开: ${clientId}, 当前连接数: ${activeProgressClients.size}`);
  });

  ws.on('error', (error) => {
    console.error('WebSocket 错误:', error);
    activeProgressClients.delete(clientId);
  });
});

function broadcastProgress(progress) {
  const message = JSON.stringify({
    type: 'progress',
    ...progress
  });

  for (const [clientId, ws] of activeProgressClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch (e) {
        console.error(`向客户端 ${clientId} 发送进度失败:`, e);
      }
    }
  }
}

function broadcastError(error) {
  const message = JSON.stringify({
    type: 'error',
    error: error.message || error
  });

  for (const [clientId, ws] of activeProgressClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch (e) {
        console.error(`向客户端 ${clientId} 发送错误失败:`, e);
      }
    }
  }
}

function broadcastComplete(result) {
  const message = JSON.stringify({
    type: 'complete',
    result
  });

  for (const [clientId, ws] of activeProgressClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch (e) {
        console.error(`向客户端 ${clientId} 发送完成消息失败:`, e);
      }
    }
  }
}

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '3D模型差异比较服务运行中',
    websocketClients: activeProgressClients.size
  });
});

app.get('/api/ws-info', (req, res) => {
  res.json({
    status: 'ok',
    wsUrl: `ws://${req.headers.host}`,
    connectedClients: activeProgressClients.size
  });
});

app.post('/api/upload', upload.fields([
  { name: 'model1', maxCount: 1 },
  { name: 'model2', maxCount: 1 }
]), (req, res) => {
  try {
    if (!req.files || !req.files.model1 || !req.files.model2) {
      return res.status(400).json({ error: '请上传两个模型文件' });
    }

    const file1 = req.files.model1[0];
    const file2 = req.files.model2[0];

    res.json({
      success: true,
      file1: {
        name: file1.originalname,
        path: file1.path,
        size: file1.size
      },
      file2: {
        name: file2.originalname,
        path: file2.path,
        size: file2.size
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/compare', upload.fields([
  { name: 'model1', maxCount: 1 },
  { name: 'model2', maxCount: 1 }
]), async (req, res) => {
  let file1 = null;
  let file2 = null;
  
  try {
    if (!req.files || !req.files.model1 || !req.files.model2) {
      return res.status(400).json({ error: '请上传两个模型文件' });
    }

    file1 = req.files.model1[0];
    file2 = req.files.model2[0];

    broadcastProgress({
      step: 0,
      message: '开始处理...',
      percent: 0,
      file1: file1.originalname,
      file2: file2.originalname
    });

    broadcastProgress({
      step: 1,
      message: '加载模型中...',
      percent: 10
    });

    const loader = new ModelLoader();
    const model1 = loader.load(file1.path);
    const model2 = loader.load(file2.path);

    const useICP = req.body.useICP !== 'false';
    const sampleCount = parseInt(req.body.sampleCount) || 10000;
    const alignMethod = req.body.alignMethod || 'icp';

    const calculator = new DiffCalculator();
    calculator.setProgressCallback((progress) => {
      broadcastProgress(progress);
    });

    broadcastProgress({
      step: 2,
      message: '计算差异中...',
      percent: 20
    });

    const result = calculator.calculate(model1, model2, {
      sampleCount,
      useICP,
      alignMethod
    });

    broadcastComplete({
      model1: {
        name: file1.originalname,
        vertexCount: model1.vertices.length,
        faceCount: model1.faces.length
      },
      model2: {
        name: file2.originalname,
        vertexCount: model2.vertices.length,
        faceCount: model2.faces.length
      },
      stats: result.stats
    });

    setTimeout(() => {
      try {
        if (file1 && fs.existsSync(file1.path)) fs.unlinkSync(file1.path);
        if (file2 && fs.existsSync(file2.path)) fs.unlinkSync(file2.path);
      } catch (e) {
        console.warn('清理临时文件失败:', e.message);
      }
    }, 5000);

    res.json({
      success: true,
      model1: {
        name: file1.originalname,
        vertexCount: model1.vertices.length,
        faceCount: model1.faces.length
      },
      model2: {
        name: file2.originalname,
        vertexCount: model2.vertices.length,
        faceCount: model2.faces.length
      },
      stats: result.stats,
      topDifferences: result.topDifferences.map(d => ({
        index: d.index,
        vertex: d.vertex,
        distance: d.distance
      })),
      heatmap: {
        colors: result.heatmap.colors.map(c => ({
          index: c.index,
          color: c.color
        }))
      },
      transform: result.transform,
      usedICP: useICP,
      alignMethod: alignMethod
    });
  } catch (error) {
    console.error('比较失败:', error);
    broadcastError(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/compare-paths', express.json(), async (req, res) => {
  try {
    const { path1, path2, useICP = true, sampleCount = 10000, alignMethod = 'icp' } = req.body;

    if (!path1 || !path2) {
      return res.status(400).json({ error: '请提供两个模型文件路径' });
    }

    if (!fs.existsSync(path1)) {
      return res.status(400).json({ error: `文件不存在: ${path1}` });
    }
    if (!fs.existsSync(path2)) {
      return res.status(400).json({ error: `文件不存在: ${path2}` });
    }

    broadcastProgress({
      step: 0,
      message: '开始处理...',
      percent: 0,
      file1: path1,
      file2: path2
    });

    const loader = new ModelLoader();
    const model1 = loader.load(path1);
    const model2 = loader.load(path2);

    const calculator = new DiffCalculator();
    calculator.setProgressCallback((progress) => {
      broadcastProgress(progress);
    });

    const result = calculator.calculate(model1, model2, {
      sampleCount,
      useICP,
      alignMethod
    });

    broadcastComplete({
      model1: { path: path1, vertexCount: model1.vertices.length, faceCount: model1.faces.length },
      model2: { path: path2, vertexCount: model2.vertices.length, faceCount: model2.faces.length },
      stats: result.stats
    });

    res.json({
      success: true,
      model1: {
        path: path1,
        vertexCount: model1.vertices.length,
        faceCount: model1.faces.length
      },
      model2: {
        path: path2,
        vertexCount: model2.vertices.length,
        faceCount: model2.faces.length
      },
      stats: result.stats,
      topDifferences: result.topDifferences.map(d => ({
        index: d.index,
        vertex: d.vertex,
        distance: d.distance
      })),
      heatmap: {
        colors: result.heatmap.colors.map(c => ({
          index: c.index,
          color: c.color
        }))
      },
      transform: result.transform,
      usedICP: useICP,
      alignMethod: alignMethod
    });
  } catch (error) {
    console.error('比较失败:', error);
    broadcastError(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/compare-timeline', upload.array('models', 20), async (req, res) => {
  const uploadedFiles = [];
  
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: '请至少上传2个模型文件' });
    }

    const files = req.files;
    const totalPairs = files.length - 1;
    const totalSteps = totalPairs + 2;
    let currentStep = 0;

    broadcastProgress({
      step: currentStep,
      message: `开始处理 ${files.length} 个模型版本...`,
      percent: 0,
      totalVersions: files.length
    });

    currentStep++;
    broadcastProgress({
      step: currentStep,
      message: '加载模型中...',
      percent: Math.round((currentStep / totalSteps) * 100)
    });

    const loader = new ModelLoader();
    const models = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      uploadedFiles.push(file.path);
      try {
        const model = loader.load(file.path);
        models.push({
          name: file.originalname,
          index: i,
          model: model
        });
      } catch (e) {
        console.error(`加载模型 ${file.originalname} 失败:`, e);
        return res.status(400).json({ error: `加载模型 ${file.originalname} 失败: ${e.message}` });
      }
    }

    const useICP = req.body.useICP !== 'false';
    const sampleCount = parseInt(req.body.sampleCount) || 10000;
    const alignMethod = req.body.alignMethod || 'simple';
    const baseVersion = parseInt(req.body.baseVersion) || 0;

    if (baseVersion < 0 || baseVersion >= models.length) {
      return res.status(400).json({ error: `基准版本索引无效: ${baseVersion}` });
    }

    currentStep++;
    broadcastProgress({
      step: currentStep,
      message: '计算版本间差异...',
      percent: Math.round((currentStep / totalSteps) * 100),
      totalPairs: totalPairs
    });

    const calculator = new DiffCalculator();
    const timelineResults = [];
    const rmsValues = [];
    const baseModel = models[baseVersion].model;
    let baseHeatmap = null;

    for (let i = 0; i < models.length; i++) {
      const currentModel = models[i];
      
      broadcastProgress({
        step: currentStep,
        message: `比较版本 ${i + 1}/${models.length}...`,
        percent: Math.round(((currentStep + (i / models.length)) / totalSteps) * 100),
        currentVersion: i
      });

      let result;
      if (i === baseVersion) {
        result = {
          stats: {
            minDistance: 0,
            maxDistance: 0,
            meanDistance: 0,
            rmsDistance: 0
          },
          topDifferences: [],
          heatmap: {
            colors: []
          },
          transform: null
        };
      } else {
        const pairResult = calculator.calculate(baseModel, currentModel.model, {
          sampleCount,
          useICP,
          alignMethod
        });
        
        const distances = pairResult.distances.map(d => d.distance);
        const rms = Math.sqrt(distances.reduce((sum, d) => sum + d * d, 0) / distances.length);
        
        result = {
          stats: {
            ...pairResult.stats,
            rmsDistance: rms
          },
          topDifferences: pairResult.topDifferences,
          heatmap: pairResult.heatmap,
          transform: pairResult.transform
        };
      }

      timelineResults.push({
        versionIndex: i,
        versionName: currentModel.name,
        ...result
      });

      rmsValues.push({
        version: i,
        versionName: currentModel.name,
        rms: result.stats.rmsDistance || 0
      });

      if (i === baseVersion) {
        baseHeatmap = result.heatmap;
      }
    }

    broadcastProgress({
      step: totalSteps,
      message: '完成！',
      percent: 100
    });

    broadcastComplete({
      totalVersions: models.length,
      rmsValues: rmsValues
    });

    setTimeout(() => {
      for (const filePath of uploadedFiles) {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (e) {
          console.warn('清理临时文件失败:', e.message);
        }
      }
    }, 5000);

    res.json({
      success: true,
      totalVersions: models.length,
      baseVersion: baseVersion,
      versions: models.map(m => ({
        index: m.index,
        name: m.name,
        vertexCount: m.model.vertices.length,
        faceCount: m.model.faces.length
      })),
      timeline: timelineResults.map(r => ({
        versionIndex: r.versionIndex,
        versionName: r.versionName,
        stats: r.stats,
        topDifferences: r.topDifferences,
        heatmap: {
          colors: r.heatmap.colors
        },
        transform: r.transform
      })),
      rmsTrend: rmsValues,
      usedICP: useICP,
      alignMethod: alignMethod
    });
  } catch (error) {
    console.error('时序比较失败:', error);
    broadcastError(error);
    res.status(500).json({ error: error.message });
  } finally {
    if (uploadedFiles.length === 0 && req.files) {
      for (const file of req.files) {
        try {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (e) {}
      }
    }
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: `文件上传错误: ${err.message}` });
  } else {
    res.status(500).json({ error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`3D模型差异比较服务运行在 http://localhost:${PORT}`);
  console.log(`WebSocket 服务运行在 ws://localhost:${PORT}`);
});

module.exports = { app, server, wss };

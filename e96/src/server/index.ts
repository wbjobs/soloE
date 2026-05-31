import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { MigrationConfig, MigrationProgress, MigrationStats } from '../types';
import { MigrationCallbacks } from '../migration/coordinator';

export interface ServerInstance {
  app: express.Application;
  server: http.Server;
  io: Server;
  callbacks: MigrationCallbacks;
}

let currentStats: MigrationStats | null = null;
let progressHistory: MigrationProgress[] = [];
let logs: string[] = [];

export async function startServer(
  config: MigrationConfig,
  port: number = 3001
): Promise<ServerInstance> {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  app.use(cors());
  app.use(express.json());
  
  const webBuildPath = path.join(__dirname, '../../web/build');
  app.use(express.static(webBuildPath));

  app.get('/api/config', (req, res) => {
    res.json({
      tables: config.tables.map(t => ({
        source: t.sourceTable,
        target: t.targetTable,
        primaryKey: t.primaryKey
      })),
      concurrency: config.concurrency,
      rateLimit: config.rateLimit,
      validate: config.validate
    });
  });

  app.get('/api/stats', (req, res) => {
    res.json(currentStats || {
      totalTables: config.tables.length,
      completedTables: 0,
      totalRows: 0,
      totalMigratedRows: 0,
      totalFailedRows: 0,
      totalValidatedRows: 0,
      totalValidationFailedRows: 0,
      startTime: 0,
      elapsedTime: 0,
      tables: config.tables.map(t => ({
        tableName: t.sourceTable,
        totalRows: 0,
        migratedRows: 0,
        failedRows: 0,
        validatedRows: 0,
        validationFailedRows: 0,
        status: 'pending',
        elapsedTime: 0,
        estimatedRemainingTime: 0,
        rowsPerSecond: 0
      }))
    });
  });

  app.get('/api/logs', (req, res) => {
    res.json(logs);
  });

  app.get('/api/progress', (req, res) => {
    res.json(progressHistory);
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(webBuildPath, 'index.html'));
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    if (currentStats) {
      socket.emit('stats', currentStats);
    }
    
    socket.emit('logs', logs);
    socket.emit('progress', progressHistory);

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  const addLog = (message: string) => {
    const timestamp = new Date().toISOString();
    logs.push(`[${timestamp}] ${message}`);
    if (logs.length > 1000) {
      logs = logs.slice(-1000);
    }
    io.emit('log', `[${timestamp}] ${message}`);
  };

  const callbacks: MigrationCallbacks = {
    onSchemaMigrate: (tableName: string) => {
      addLog(`Schema migrated for table: ${tableName}`);
    },
    onProgress: (progress: MigrationProgress) => {
      const existingIndex = progressHistory.findIndex(p => p.tableName === progress.tableName);
      if (existingIndex >= 0) {
        progressHistory[existingIndex] = progress;
      } else {
        progressHistory.push(progress);
      }
      io.emit('progress', progress);
    },
    onStats: (stats: MigrationStats) => {
      currentStats = stats;
      io.emit('stats', stats);
    },
    onComplete: () => {
      addLog('Migration completed successfully!');
      io.emit('complete', { timestamp: Date.now() });
    },
    onError: (error: Error) => {
      addLog(`Error: ${error.message}`);
      io.emit('error', { message: error.message, timestamp: Date.now() });
    }
  };

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
      addLog(`Server started on port ${port}`);
      resolve();
    });
  });

  return { app, server, io, callbacks };
}

export function stopServer(instance: ServerInstance): Promise<void> {
  return new Promise((resolve, reject) => {
    instance.server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

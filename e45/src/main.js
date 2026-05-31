const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const GitService = require('./services/gitService');
const Analyzer = require('./services/analyzer');

let mainWindow;
let gitService;
let analyzer;
const cache = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  gitService = new GitService();
  analyzer = new Analyzer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('analyze-repo', async (event, repoPath) => {
  try {
    if (cache.has(repoPath)) {
      return processAnalysisData(cache.get(repoPath));
    }

    const commits = await gitService.getCommits(repoPath);
    cache.set(repoPath, commits);
    return processAnalysisData(commits);
  } catch (error) {
    throw new Error(error.message);
  }
});

ipcMain.handle('refresh-repo', async (event, repoPath) => {
  try {
    cache.delete(repoPath);
    const commits = await gitService.getCommits(repoPath);
    cache.set(repoPath, commits);
    return processAnalysisData(commits);
  } catch (error) {
    throw new Error(error.message);
  }
});

function processAnalysisData(commits) {
  return {
    totalCommits: commits.length,
    commitTypes: analyzer.classifyCommits(commits),
    heatmapData: analyzer.generateHeatmapData(commits),
    anomalies: analyzer.detectAnomalies(commits),
    timelineData: analyzer.generateTimelineData(commits),
    contributors: analyzer.getContributors(commits),
    relationships: analyzer.analyzeCommitRelationships(commits),
    rawCommits: commits
  };
}

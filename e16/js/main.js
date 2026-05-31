const CELL_SIZE = 28;
const MAZE_WIDTH = 20;
const MAZE_HEIGHT = 20;
const CANVAS_WIDTH = MAZE_WIDTH * CELL_SIZE;
const CANVAS_HEIGHT = MAZE_HEIGHT * CELL_SIZE;

const COLORS = {
  wall: 0x374151,
  path: 0xf9fafb,
  visited: 0x93c5fd,
  open: 0xfbbf24,
  finalPath: 0x34d399,
  startEnd: 0x8b5cf6
};

class MazeScene extends Phaser.Scene {
  constructor() {
    super('MazeScene');
    this.mazeGenerator = null;
    this.pathFinder = null;
    this.mazeData = null;
    this.graphics = null;
    this.isGenerating = false;
    this.isPathfinding = false;
    this.currentAlgorithm = 'recursive';
  }

  create() {
    this.graphics = this.add.graphics();
    
    this.mazeGenerator = new MazeGenerator(MAZE_WIDTH, MAZE_HEIGHT, this.currentAlgorithm);
    this.initAlgorithmSelect();
    this.initMaze();
    
    window.generateMaze = () => this.generateMazeWithAnimation();
    window.startPathfinding = () => this.startPathfinding();
  }

  initAlgorithmSelect() {
    const select = document.getElementById('algorithmSelect');
    const algorithms = MazeGenerator.getAlgorithms();
    
    select.innerHTML = '';
    for (const algo of algorithms) {
      const option = document.createElement('option');
      option.value = algo.id;
      option.textContent = algo.name;
      select.appendChild(option);
    }
    
    select.value = this.currentAlgorithm;
    
    select.addEventListener('change', (e) => {
      this.currentAlgorithm = e.target.value;
      this.mazeGenerator.setAlgorithm(this.currentAlgorithm);
      const algoName = this.mazeGenerator.getAlgorithmName();
      this.updateStatus(`已选择: ${algoName}`);
    });
  }

  initMaze() {
    this.graphics.clear();
    this.mazeGenerator.initGrid();
    this.mazeData = this.mazeGenerator.getMazeData();
    this.drawFullMaze();
  }

  drawFullMaze() {
    this.graphics.clear();
    
    for (let y = 0; y < MAZE_HEIGHT; y++) {
      for (let x = 0; x < MAZE_WIDTH; x++) {
        this.drawCell(x, y, COLORS.path);
      }
    }
  }

  drawCell(x, y, color) {
    const cellX = x * CELL_SIZE;
    const cellY = y * CELL_SIZE;
    const cell = this.mazeData[y][x];

    this.graphics.fillStyle(color);
    this.graphics.fillRect(cellX + 2, cellY + 2, CELL_SIZE - 4, CELL_SIZE - 4);

    this.graphics.fillStyle(COLORS.wall);
    const wallThickness = 3;

    if (cell.walls.top) {
      this.graphics.fillRect(cellX, cellY, CELL_SIZE, wallThickness);
    }
    if (cell.walls.right) {
      this.graphics.fillRect(cellX + CELL_SIZE - wallThickness, cellY, wallThickness, CELL_SIZE);
    }
    if (cell.walls.bottom) {
      this.graphics.fillRect(cellX, cellY + CELL_SIZE - wallThickness, CELL_SIZE, wallThickness);
    }
    if (cell.walls.left) {
      this.graphics.fillRect(cellX, cellY, wallThickness, CELL_SIZE);
    }
  }

  updateCellWalls(x, y, walls) {
    if (this.mazeData[y] && this.mazeData[y][x]) {
      this.mazeData[y][x].walls = { ...walls };
      this.drawCell(x, y, COLORS.path);
    }
  }

  async generateMazeWithAnimation() {
    if (this.isGenerating || this.isPathfinding) return;
    
    this.isGenerating = true;
    this.updateButtons();
    const algoName = this.mazeGenerator.getAlgorithmName();
    this.updateStatus(`正在使用 ${algoName} 生成迷宫...`);

    const animationSteps = this.mazeGenerator.generate();
    this.mazeData = this.mazeGenerator.getMazeData();
    
    this.drawFullMaze();

    for (let i = 0; i < animationSteps.length; i++) {
      const step = animationSteps[i];
      
      if (step.type === 'remove_wall') {
        this.updateCellWalls(step.x, step.y, step.walls);
        this.updateCellWalls(step.nextX, step.nextY, step.nextWalls);
      }
      
      await this.delay(15);
    }

    this.highlightStartEnd();
    
    this.isGenerating = false;
    this.updateButtons();
    this.updateStatus(`✅ ${algoName} 迷宫生成完成！点击"开始寻路"按钮寻找路径。`);
  }

  async startPathfinding() {
    if (this.isGenerating || this.isPathfinding) return;
    
    this.isPathfinding = true;
    this.updateButtons();
    this.updateStatus('正在寻找路径...');

    try {
      this.pathFinder = new PathFinder(this.mazeData);
      
      const start = { x: 0, y: 0 };
      const end = { x: MAZE_WIDTH - 1, y: MAZE_HEIGHT - 1 };
      
      const path = this.pathFinder.findPath(start, end);
      const animationSteps = this.pathFinder.getAnimationSteps();

      const maxAnimationSteps = 5000;
      const actualSteps = Math.min(animationSteps.length, maxAnimationSteps);
      const stepInterval = Math.max(1, Math.ceil(animationSteps.length / maxAnimationSteps));

      for (let i = 0; i < animationSteps.length; i += stepInterval) {
        const step = animationSteps[Math.min(i, animationSteps.length - 1)];
        
        if (step.type === 'explore' || step.type === 'current') {
          this.drawPathfindingState(step.openSet, step.closedSet);
        } else if (step.type === 'path') {
          this.drawFinalPath(step.path);
        }
        
        await this.delay(20);
      }

      if (animationSteps.length > 0 && animationSteps[animationSteps.length - 1].type === 'path') {
        const lastStep = animationSteps[animationSteps.length - 1];
        this.drawFinalPath(lastStep.path);
      }

      this.highlightStartEnd();
      
      this.isPathfinding = false;
      this.updateButtons();
      
      if (path.length > 0) {
        this.updateStatus(`✅ 寻路完成！找到路径，共 ${path.length} 步。`);
      } else {
        this.updateStatus('⚠️ 未找到有效路径！迷宫可能无解。');
      }
    } catch (error) {
      console.error('寻路过程出错:', error);
      this.isPathfinding = false;
      this.updateButtons();
      this.updateStatus('❌ 寻路过程出错，请重新生成迷宫后再试。');
    }
  }

  drawPathfindingState(openSet, closedSet) {
    this.drawFullMaze();
    
    for (const cell of closedSet) {
      this.drawCellColor(cell.x, cell.y, COLORS.visited);
    }
    
    for (const cell of openSet) {
      this.drawCellColor(cell.x, cell.y, COLORS.open);
    }
    
    this.highlightStartEnd();
  }

  drawCellColor(x, y, color) {
    const cellX = x * CELL_SIZE;
    const cellY = y * CELL_SIZE;
    
    this.graphics.fillStyle(color);
    this.graphics.fillRect(cellX + 4, cellY + 4, CELL_SIZE - 8, CELL_SIZE - 8);
  }

  drawFinalPath(path) {
    this.drawFullMaze();
    
    for (const cell of path) {
      this.drawCellColor(cell.x, cell.y, COLORS.finalPath);
    }
  }

  highlightStartEnd() {
    this.drawCellColor(0, 0, COLORS.startEnd);
    this.drawCellColor(MAZE_WIDTH - 1, MAZE_HEIGHT - 1, COLORS.startEnd);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  updateButtons() {
    const generateBtn = document.getElementById('generateBtn');
    const pathBtn = document.getElementById('pathBtn');
    
    const isBusy = this.isGenerating || this.isPathfinding;
    
    generateBtn.disabled = isBusy;
    pathBtn.disabled = isBusy;
  }

  updateStatus(message) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
      statusElement.textContent = message;
    }
  }
}

const config = {
  type: Phaser.CANVAS,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  scene: MazeScene,
  parent: 'gameContainer',
  canvasStyle: 'border-radius: 12px;'
};

window.addEventListener('load', () => {
  const game = new Phaser.Game(config);
  
  document.getElementById('status').textContent = 
    '欢迎！点击"生成迷宫"按钮开始，使用递归回溯算法生成20x20的迷宫。';
});

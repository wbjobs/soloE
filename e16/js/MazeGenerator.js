class MazeGenerator {
  constructor(width, height, algorithm = 'recursive') {
    this.width = width;
    this.height = height;
    this.grid = [];
    this.animationSteps = [];
    this.algorithm = algorithm;
  }

  static getAlgorithms() {
    return [
      { id: 'recursive', name: '递归回溯算法 (Recursive Backtracking)' },
      { id: 'prim', name: 'Prim 算法 (Randomized Prim)' },
      { id: 'dfs', name: '深度优先搜索 (Depth-First Search)' }
    ];
  }

  setAlgorithm(algorithm) {
    this.algorithm = algorithm;
  }

  initGrid() {
    for (let y = 0; y < this.height; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x] = {
          x: x,
          y: y,
          walls: { top: true, right: true, bottom: true, left: true },
          visited: false
        };
      }
    }
  }

  getNeighbors(cell, onlyUnvisited = true) {
    const neighbors = [];
    const x = cell.x;
    const y = cell.y;

    const directions = [
      { dx: 0, dy: -1, name: 'top', opposite: 'bottom' },
      { dx: 1, dy: 0, name: 'right', opposite: 'left' },
      { dx: 0, dy: 1, name: 'bottom', opposite: 'top' },
      { dx: -1, dy: 0, name: 'left', opposite: 'right' }
    ];

    for (const dir of directions) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;

      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        const neighbor = this.grid[ny][nx];
        if (!onlyUnvisited || !neighbor.visited) {
          neighbors.push({
            cell: neighbor,
            direction: dir.name,
            opposite: dir.opposite
          });
        }
      }
    }

    return neighbors;
  }

  removeWall(current, nextData) {
    current.walls[nextData.direction] = false;
    nextData.cell.walls[nextData.opposite] = false;
  }

  addAnimationStep(current, nextData = null) {
    if (nextData) {
      this.animationSteps.push({
        type: 'remove_wall',
        x: current.x,
        y: current.y,
        nextX: nextData.cell.x,
        nextY: nextData.cell.y,
        walls: { ...current.walls },
        nextWalls: { ...nextData.cell.walls }
      });
    } else {
      this.animationSteps.push({
        type: 'visit',
        x: current.x,
        y: current.y,
        walls: { ...current.walls }
      });
    }
  }

  generateRecursiveBacktracking() {
    const stack = [];
    const startCell = this.grid[0][0];
    startCell.visited = true;
    stack.push(startCell);
    this.addAnimationStep(startCell);

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighbors = this.getNeighbors(current, true);

      if (neighbors.length > 0) {
        const randomIndex = Math.floor(Math.random() * neighbors.length);
        const nextData = neighbors[randomIndex];

        this.removeWall(current, nextData);
        nextData.cell.visited = true;
        stack.push(nextData.cell);
        this.addAnimationStep(current, nextData);
      } else {
        stack.pop();
      }
    }

    return this.animationSteps;
  }

  generatePrim() {
    const walls = [];
    const startCell = this.grid[0][0];
    startCell.visited = true;
    this.addAnimationStep(startCell);

    const startNeighbors = this.getNeighbors(startCell, false);
    for (const neighbor of startNeighbors) {
      walls.push({ from: startCell, to: neighbor });
    }

    while (walls.length > 0) {
      const randomIndex = Math.floor(Math.random() * walls.length);
      const wall = walls[randomIndex];
      walls.splice(randomIndex, 1);

      const nextCell = wall.to.cell;

      if (!nextCell.visited) {
        this.removeWall(wall.from, wall.to);
        nextCell.visited = true;
        this.addAnimationStep(wall.from, wall.to);

        const neighbors = this.getNeighbors(nextCell, false);
        for (const neighbor of neighbors) {
          if (!neighbor.cell.visited) {
            const exists = walls.some(w =>
              w.to.cell.x === neighbor.cell.x && w.to.cell.y === neighbor.cell.y
            );
            if (!exists) {
              walls.push({ from: nextCell, to: neighbor });
            }
          }
        }
      }
    }

    return this.animationSteps;
  }

  generateDFS() {
    const stack = [];
    const visited = new Set();

    const startCell = this.grid[0][0];
    startCell.visited = true;
    visited.add(`${startCell.x},${startCell.y}`);
    stack.push({ cell: startCell, parent: null });
    this.addAnimationStep(startCell);

    while (stack.length > 0) {
      const { cell: current, parent } = stack[stack.length - 1];
      const neighbors = this.getNeighbors(current, true);

      if (neighbors.length > 0) {
        const nextData = neighbors[0];
        this.removeWall(current, nextData);
        nextData.cell.visited = true;
        visited.add(`${nextData.cell.x},${nextData.cell.y}`);
        stack.push({ cell: nextData.cell, parent: current });
        this.addAnimationStep(current, nextData);
      } else {
        stack.pop();
      }
    }

    return this.animationSteps;
  }

  generate() {
    this.initGrid();
    this.animationSteps = [];

    switch (this.algorithm) {
      case 'prim':
        return this.generatePrim();
      case 'dfs':
        return this.generateDFS();
      case 'recursive':
      default:
        return this.generateRecursiveBacktracking();
    }
  }

  getMazeData() {
    return this.grid;
  }

  getAnimationSteps() {
    return this.animationSteps;
  }

  getAlgorithmName() {
    const algorithms = MazeGenerator.getAlgorithms();
    const algo = algorithms.find(a => a.id === this.algorithm);
    return algo ? algo.name : '未知算法';
  }
}

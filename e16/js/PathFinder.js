class PathFinder {
  constructor(mazeData) {
    this.maze = mazeData;
    this.openSet = [];
    this.closedSet = new Set();
    this.animationSteps = [];
    this.cameFrom = new Map();
    this.gScores = new Map();
    this.fScores = new Map();
    this.maxIterations = 0;
    this.maxIterationLimit = 10000;
  }

  heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  getKey(x, y) {
    return `${x},${y}`;
  }

  getCellKey(cell) {
    return this.getKey(cell.x, cell.y);
  }

  getWalkableNeighbors(cell) {
    const neighbors = [];
    const x = cell.x;
    const y = cell.y;
    const walls = cell.walls;

    if (!walls.top && y > 0) {
      neighbors.push(this.maze[y - 1][x]);
    }
    if (!walls.right && x < this.maze[0].length - 1) {
      neighbors.push(this.maze[y][x + 1]);
    }
    if (!walls.bottom && y < this.maze.length - 1) {
      neighbors.push(this.maze[y + 1][x]);
    }
    if (!walls.left && x > 0) {
      neighbors.push(this.maze[y][x - 1]);
    }

    return neighbors;
  }

  isInClosedSet(cell) {
    return this.closedSet.has(this.getCellKey(cell));
  }

  addToClosedSet(cell) {
    this.closedSet.add(this.getCellKey(cell));
  }

  findInOpenSet(cell) {
    return this.openSet.find(c => c.x === cell.x && c.y === cell.y);
  }

  findPath(start, end) {
    this.openSet = [];
    this.closedSet = new Set();
    this.animationSteps = [];
    this.cameFrom = new Map();
    this.gScores = new Map();
    this.fScores = new Map();
    this.maxIterations = 0;

    const startCell = this.maze[start.y][start.x];
    const endCell = this.maze[end.y][end.x];

    const startKey = this.getCellKey(startCell);
    this.gScores.set(startKey, 0);
    this.fScores.set(startKey, this.heuristic(start, end));

    this.openSet.push(startCell);

    while (this.openSet.length > 0) {
      this.maxIterations++;
      if (this.maxIterations > this.maxIterationLimit) {
        console.warn('A* 算法达到迭代上限，防止无限循环');
        return [];
      }

      this.openSet.sort((a, b) => {
        const fA = this.fScores.get(this.getCellKey(a)) || Infinity;
        const fB = this.fScores.get(this.getCellKey(b)) || Infinity;
        return fA - fB;
      });

      const current = this.openSet[0];
      const currentKey = this.getCellKey(current);

      if (current.x === end.x && current.y === end.y) {
        this.animationSteps.push({
          type: 'current',
          x: current.x,
          y: current.y,
          openSet: this.openSet.map(c => ({ x: c.x, y: c.y })),
          closedSet: Array.from(this.closedSet).map(k => {
            const [x, y] = k.split(',').map(Number);
            return { x, y };
          })
        });
        return this.reconstructPath(current);
      }

      this.openSet.shift();
      this.addToClosedSet(current);

      this.animationSteps.push({
        type: 'explore',
        x: current.x,
        y: current.y,
        openSet: this.openSet.map(c => ({ x: c.x, y: c.y })),
        closedSet: Array.from(this.closedSet).map(k => {
          const [x, y] = k.split(',').map(Number);
          return { x, y };
        })
      });

      const neighbors = this.getWalkableNeighbors(current);
      const currentG = this.gScores.get(currentKey) || 0;

      for (const neighbor of neighbors) {
        if (this.isInClosedSet(neighbor)) {
          continue;
        }

        const neighborKey = this.getCellKey(neighbor);
        const tentativeG = currentG + 1;
        const neighborG = this.gScores.get(neighborKey);

        if (neighborG === undefined || tentativeG < neighborG) {
          this.cameFrom.set(neighborKey, current);
          this.gScores.set(neighborKey, tentativeG);
          this.fScores.set(neighborKey, tentativeG + this.heuristic(neighbor, end));

          const inOpenSet = this.findInOpenSet(neighbor);
          if (!inOpenSet) {
            this.openSet.push(neighbor);
          }
        }
      }
    }

    return [];
  }

  reconstructPath(current) {
    const path = [];
    let cell = current;
    const visited = new Set();
    let safetyCount = 0;
    const maxSafetySteps = 1000;

    while (cell) {
      safetyCount++;
      if (safetyCount > maxSafetySteps) {
        console.warn('路径重建达到安全上限，防止无限循环');
        break;
      }

      const cellKey = this.getCellKey(cell);
      if (visited.has(cellKey)) {
        console.warn('检测到循环引用，中断路径重建');
        break;
      }
      visited.add(cellKey);

      path.unshift({ x: cell.x, y: cell.y });
      cell = this.cameFrom.get(cellKey);
    }

    this.animationSteps.push({
      type: 'path',
      path: path
    });

    return path;
  }

  getAnimationSteps() {
    return this.animationSteps;
  }
}

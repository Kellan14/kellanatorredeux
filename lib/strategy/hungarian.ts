/**
 * Hungarian Algorithm (Munkres Algorithm) for optimal assignment
 * Finds the maximum weight matching in a bipartite graph
 * Time complexity: O(n^3)
 */

export interface HungarianResult {
  assignments: number[] // assignments[i] = j means row i is assigned to column j
  totalCost: number
}

/**
 * Solve the assignment problem using the Hungarian algorithm
 * @param costMatrix - Square matrix where costMatrix[i][j] is the cost of assigning row i to column j
 * @param maximize - If true, maximizes the total cost; if false, minimizes it
 * @returns Optimal assignments and total cost
 */
export function hungarianAlgorithm(
  costMatrix: number[][],
  maximize: boolean = true
): HungarianResult {
  const n = costMatrix.length
  if (n === 0) {
    return { assignments: [], totalCost: 0 }
  }

  // Make a copy and convert to minimization problem if needed
  let matrix = costMatrix.map(row => [...row])

  if (maximize) {
    // Convert maximization to minimization by negating values
    const maxValue = Math.max(...matrix.flat())
    matrix = matrix.map(row => row.map(val => maxValue - val))
  }

  // Step 1: Subtract row minimums
  for (let i = 0; i < n; i++) {
    const rowMin = Math.min(...matrix[i])
    for (let j = 0; j < n; j++) {
      matrix[i][j] -= rowMin
    }
  }

  // Step 2: Subtract column minimums
  for (let j = 0; j < n; j++) {
    let colMin = matrix[0][j]
    for (let i = 1; i < n; i++) {
      colMin = Math.min(colMin, matrix[i][j])
    }
    for (let i = 0; i < n; i++) {
      matrix[i][j] -= colMin
    }
  }

  // Step 3: Cover all zeros with minimum number of lines
  // Step 4: Create additional zeros if needed
  // Step 5: Find optimal assignment
  const assignments = findOptimalAssignment(matrix, n)

  // Calculate total cost from original matrix
  let totalCost = 0
  for (let i = 0; i < n; i++) {
    if (assignments[i] !== -1) {
      totalCost += costMatrix[i][assignments[i]]
    }
  }

  return { assignments, totalCost }
}

function findOptimalAssignment(matrix: number[][], n: number): number[] {
  const assignments = new Array(n).fill(-1)
  const rowCovered = new Array(n).fill(false)
  const colCovered = new Array(n).fill(false)

  // Try to find a zero in each row and mark it
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i][j] === 0 && !rowCovered[i] && !colCovered[j]) {
        assignments[i] = j
        rowCovered[i] = true
        colCovered[j] = true
        break
      }
    }
  }

  // Check if we have a complete assignment
  let assignedCount = assignments.filter(a => a !== -1).length

  if (assignedCount === n) {
    return assignments
  }

  // If not complete, use augmenting path method
  return augmentingPathMethod(matrix, n)
}

function augmentingPathMethod(matrix: number[][], n: number): number[] {
  const assignments = new Array(n).fill(-1)
  const colAssignment = new Array(n).fill(-1)

  for (let row = 0; row < n; row++) {
    const visited = new Array(n).fill(false)
    if (findPath(row, matrix, assignments, colAssignment, visited, n)) {
      // Path found, assignment updated
    } else {
      // No path found, reduce matrix and try again
      reduceMatrix(matrix, n)
      const visited2 = new Array(n).fill(false)
      findPath(row, matrix, assignments, colAssignment, visited2, n)
    }
  }

  return assignments
}

function findPath(
  row: number,
  matrix: number[][],
  assignments: number[],
  colAssignment: number[],
  visited: boolean[],
  n: number
): boolean {
  for (let col = 0; col < n; col++) {
    if (matrix[row][col] === 0 && !visited[col]) {
      visited[col] = true

      if (colAssignment[col] === -1 ||
          findPath(colAssignment[col], matrix, assignments, colAssignment, visited, n)) {
        assignments[row] = col
        colAssignment[col] = row
        return true
      }
    }
  }
  return false
}

function reduceMatrix(matrix: number[][], n: number) {
  // Find minimum uncovered value
  let minUncovered = Infinity
  const rowCovered = new Array(n).fill(false)
  const colCovered = new Array(n).fill(false)

  // Mark covered rows and columns based on current zeros
  for (let i = 0; i < n; i++) {
    let hasZero = false
    for (let j = 0; j < n; j++) {
      if (matrix[i][j] === 0) {
        hasZero = true
        colCovered[j] = true
      }
    }
    if (!hasZero) rowCovered[i] = true
  }

  // Find minimum uncovered value
  for (let i = 0; i < n; i++) {
    if (!rowCovered[i]) {
      for (let j = 0; j < n; j++) {
        if (!colCovered[j]) {
          minUncovered = Math.min(minUncovered, matrix[i][j])
        }
      }
    }
  }

  if (minUncovered === Infinity) return

  // Adjust matrix
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!rowCovered[i] && !colCovered[j]) {
        matrix[i][j] -= minUncovered
      } else if (rowCovered[i] && colCovered[j]) {
        matrix[i][j] += minUncovered
      }
    }
  }
}

/**
 * Simple greedy assignment for comparison
 * Not optimal but fast - O(n^2 log n)
 */
export function greedyAssignment(costMatrix: number[][], maximize: boolean = true): HungarianResult {
  const n = costMatrix.length
  const assignments = new Array(n).fill(-1)
  const used = new Set<number>()

  // Create list of all (value, row, col) tuples
  const cells: Array<{value: number, row: number, col: number}> = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cells.push({ value: costMatrix[i][j], row: i, col: j })
    }
  }

  // Sort by value (descending for maximize, ascending for minimize)
  cells.sort((a, b) => maximize ? b.value - a.value : a.value - b.value)

  // Assign greedily
  for (const cell of cells) {
    if (assignments[cell.row] === -1 && !used.has(cell.col)) {
      assignments[cell.row] = cell.col
      used.add(cell.col)

      if (used.size === n) break
    }
  }

  // Calculate total cost
  let totalCost = 0
  for (let i = 0; i < n; i++) {
    if (assignments[i] !== -1) {
      totalCost += costMatrix[i][assignments[i]]
    }
  }

  return { assignments, totalCost }
}

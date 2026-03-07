/**
 * Hungarian Algorithm (Munkres Algorithm) for optimal assignment
 * Finds the optimal matching in a bipartite graph
 * Time complexity: O(n^3)
 */

export interface HungarianResult {
  assignments: number[] // assignments[i] = j means row i is assigned to column j
  totalCost: number
}

/**
 * Solve the assignment problem using the Hungarian algorithm.
 * Uses the shortest augmenting path method which guarantees a complete assignment
 * for any square cost matrix.
 *
 * @param costMatrix - Square matrix where costMatrix[i][j] is the cost/score
 * @param maximize - If true, maximizes; if false, minimizes
 */
export function hungarianAlgorithm(
  costMatrix: number[][],
  maximize: boolean = true
): HungarianResult {
  const n = costMatrix.length
  if (n === 0) {
    return { assignments: [], totalCost: 0 }
  }

  // Convert to minimization if needed
  let cost: number[][]
  if (maximize) {
    const maxVal = Math.max(...costMatrix.flat())
    cost = costMatrix.map(row => row.map(val => maxVal - val))
  } else {
    cost = costMatrix.map(row => [...row])
  }

  // u[i] = potential for row i, v[j] = potential for column j
  // p[j] = row assigned to column j (0-indexed, -1 = unassigned)
  // Using 1-indexed internally for cleaner algorithm, then convert
  const u = new Array(n + 1).fill(0)
  const v = new Array(n + 1).fill(0)
  const p = new Array(n + 1).fill(0) // p[j] = row assigned to col j (1-indexed)
  const way = new Array(n + 1).fill(0)

  for (let i = 1; i <= n; i++) {
    // Start augmenting path from row i
    p[0] = i
    let j0 = 0 // virtual column
    const minv = new Array(n + 1).fill(Infinity)
    const used = new Array(n + 1).fill(false)

    do {
      used[j0] = true
      let i0 = p[j0]
      let delta = Infinity
      let j1 = -1

      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
          if (cur < minv[j]) {
            minv[j] = cur
            way[j] = j0
          }
          if (minv[j] < delta) {
            delta = minv[j]
            j1 = j
          }
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }

      j0 = j1
    } while (p[j0] !== 0)

    // Update assignment along the augmenting path
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }

  // Convert from column-based to row-based assignments (0-indexed)
  const assignments = new Array(n).fill(-1)
  for (let j = 1; j <= n; j++) {
    if (p[j] !== 0) {
      assignments[p[j] - 1] = j - 1
    }
  }

  // Calculate total cost from original matrix
  let totalCost = 0
  for (let i = 0; i < n; i++) {
    if (assignments[i] !== -1) {
      totalCost += costMatrix[i][assignments[i]]
    }
  }

  return { assignments, totalCost }
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

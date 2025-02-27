class PriorityQueue {
  constructor() {
    this.values = [];
  }

  enqueue(val, priority) {
    this.values.push({ val, priority });
    this.sort();
  }

  dequeue() {
    return this.values.shift();
  }

  sort() {
    this.values.sort((a, b) => a.priority - b.priority);
  }
}

function dijkstra(graph, start, end) {
  const nodes = new PriorityQueue();
  const distances = {};
  const previous = {};
  const path = [];
  let smallest;

  // Build initial state
  for (let vertex in graph) {
    if (vertex === start) {
      distances[vertex] = 0;
      nodes.enqueue(vertex, 0);
    } else {
      distances[vertex] = Infinity;
      nodes.enqueue(vertex, Infinity);
    }
    previous[vertex] = null;
  }

  // As long as there are nodes to visit
  while (nodes.values.length) {
    smallest = nodes.dequeue().val;
    if (smallest === end) {
      // Build path to return
      while (previous[smallest]) {
        path.push(smallest);
        smallest = previous[smallest];
      }
      break;
    }

    if (smallest || distances[smallest] !== Infinity) {
      for (let neighbor in graph[smallest]) {
        // Find neighboring node
        let nextNode = graph[smallest][neighbor];
        // Calculate new distance to neighboring node
        let candidate = distances[smallest] + nextNode.weight;
        let nextNeighbor = nextNode.node;
        
        if (candidate < distances[nextNeighbor]) {
          // Updating new smallest distance to neighbor
          distances[nextNeighbor] = candidate;
          // Updating previous - How we got to neighbor
          previous[nextNeighbor] = smallest;
          // Enqueue in priority queue with new priority
          nodes.enqueue(nextNeighbor, candidate);
        }
      }
    }
  }
  
  return {
    distance: distances[end],
    path: [start, ...path.reverse()]
  };
}

// Example usage:
const graph = {
  A: { B: { node: 'B', weight: 4 }, C: { node: 'C', weight: 2 } },
  B: { E: { node: 'E', weight: 3 } },
  C: { D: { node: 'D', weight: 2 }, F: { node: 'F', weight: 4 } },
  D: { E: { node: 'E', weight: 3 }, F: { node: 'F', weight: 1 } },
  E: { F: { node: 'F', weight: 1 } },
  F: {}
};

console.log(dijkstra(graph, 'A', 'F'));
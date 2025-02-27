class GroceryListOptimizer {
    constructor() {
        this.groceryList = new Map();
        this.storeLayout = new Map();
        this.aisleGraph = new Map();
        this.currentRoute = [];
    }

    async init() {
        await this.loadStoreLayout();
        this.setupUI();
        this.initializeGraph();
    }

    async loadStoreLayout() {
        try {
            const response = await fetch('https://api.example.com/store-layout');
            const layout = await response.json();
            
            layout.aisles.forEach(aisle => {
                this.storeLayout.set(aisle.id, {
                    ...aisle,
                    items: new Set(aisle.items)
                });
            });
        } catch (error) {
            console.error('Failed to load store layout:', error);
        }
    }

    setupUI() {
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="grocery-optimizer">
                <div class="input-section">
                    <div class="add-item-form">
                        <input type="text" id="item-input" placeholder="Add item...">
                        <button id="add-item">Add</button>
                    </div>
                    <div class="list-section">
                        <h3>Your Grocery List</h3>
                        <div id="grocery-list" class="grocery-list"></div>
                    </div>
                </div>
                
                <div class="map-section">
                    <div class="store-map" id="store-map"></div>
                    <div class="route-info">
                        <h3>Shopping Route</h3>
                        <div id="route-steps"></div>
                        <button id="optimize-route">Optimize Route</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(container);
        this.bindEvents();
        this.renderStoreMap();
    }

    initializeGraph() {
        // Create a graph representation of the store layout for pathfinding
        this.storeLayout.forEach((aisle, aisleId) => {
            const connections = new Map();
            
            // Connect adjacent aisles
            aisle.adjacent.forEach(adjAisleId => {
                connections.set(adjAisleId, 1); // Weight of 1 for adjacent aisles
            });
            
            this.aisleGraph.set(aisleId, connections);
        });
    }

    bindEvents() {
        document.getElementById('add-item').onclick = () => {
            const input = document.getElementById('item-input');
            if (input.value.trim()) {
                this.addItem(input.value.trim());
                input.value = '';
            }
        };

        document.getElementById('item-input').onkeypress = (e) => {
            if (e.key === 'Enter' && e.target.value.trim()) {
                this.addItem(e.target.value.trim());
                e.target.value = '';
            }
        };

        document.getElementById('optimize-route').onclick = () => {
            this.optimizeRoute();
        };
    }

    addItem(itemName) {
        const aisleId = this.findItemAisle(itemName);
        if (aisleId) {
            this.groceryList.set(itemName, {
                aisleId,
                collected: false
            });
            this.renderGroceryList();
            this.updateStoreMap();
        }
    }

    findItemAisle(itemName) {
        for (const [aisleId, aisle] of this.storeLayout) {
            if (aisle.items.has(itemName.toLowerCase())) {
                return aisleId;
            }
        }
        return null;
    }

    renderGroceryList() {
        const listContainer = document.getElementById('grocery-list');
        listContainer.innerHTML = Array.from(this.groceryList.entries())
            .map(([item, details]) => `
                <div class="list-item ${details.collected ? 'collected' : ''}"
                     data-item="${item}">
                    <input type="checkbox" 
                           ${details.collected ? 'checked' : ''}
                           onchange="this.closest('.grocery-optimizer').__vue__.toggleItem('${item}')">
                    <span>${item}</span>
                    <small>Aisle ${details.aisleId}</small>
                </div>
            `).join('');
    }

    renderStoreMap() {
        const mapContainer = document.getElementById('store-map');
        const svg = d3.select(mapContainer)
            .append('svg')
            .attr('width', '100%')
            .attr('height', '600');

        // Create store layout visualization
        this.drawStoreLayout(svg);
        this.updateStoreMap();
    }

    drawStoreLayout(svg) {
        const aisleWidth = 60;
        const aisleHeight = 200;
        const padding = 20;

        this.storeLayout.forEach((aisle, aisleId) => {
            const x = (aisleId - 1) * (aisleWidth + padding) + padding;
            const y = padding;

            svg.append('rect')
                .attr('x', x)
                .attr('y', y)
                .attr('width', aisleWidth)
                .attr('height', aisleHeight)
                .attr('class', 'aisle')
                .attr('id', `aisle-${aisleId}`);

            svg.append('text')
                .attr('x', x + aisleWidth/2)
                .attr('y', y - 5)
                .attr('text-anchor', 'middle')
                .text(`Aisle ${aisleId}`);
        });
    }

    updateStoreMap() {
        const svg = d3.select('#store-map svg');
        
        // Clear previous highlights
        svg.selectAll('.aisle').classed('highlighted', false);
        
        // Highlight aisles with items
        this.groceryList.forEach((details) => {
            svg.select(`#aisle-${details.aisleId}`)
                .classed('highlighted', true);
        });

        // Draw route if exists
        this.drawRoute(svg);
    }

    drawRoute(svg) {
        svg.selectAll('.route-path').remove();

        if (this.currentRoute.length < 2) return;

        const line = d3.line()
            .x(d => d.x)
            .y(d => d.y)
            .curve(d3.curveMonotoneX);

        const routePoints = this.currentRoute.map(aisleId => {
            const aisle = document.getElementById(`aisle-${aisleId}`);
            const rect = aisle.getBoundingClientRect();
            return {
                x: rect.x + rect.width/2,
                y: rect.y + rect.height/2
            };
        });

        svg.append('path')
            .datum(routePoints)
            .attr('class', 'route-path')
            .attr('d', line);
    }

    optimizeRoute() {
        const itemsByAisle = new Map();
        
        // Group items by aisle
        this.groceryList.forEach((details, item) => {
            if (!itemsByAisle.has(details.aisleId)) {
                itemsByAisle.set(details.aisleId, []);
            }
            itemsByAisle.get(details.aisleId).push(item);
        });

        // Find optimal route using nearest neighbor algorithm
        const aisles = Array.from(itemsByAisle.keys());
        this.currentRoute = this.findOptimalRoute(aisles);
        
        this.updateStoreMap();
        this.renderRouteSteps(itemsByAisle);
    }

    findOptimalRoute(aisles) {
        if (aisles.length === 0) return [];
        
        const route = [aisles[0]];
        const unvisited = new Set(aisles.slice(1));

        while (unvisited.size > 0) {
            const current = route[route.length - 1];
            let nearest = null;
            let minDistance = Infinity;

            unvisited.forEach(aisle => {
                const distance = this.getAisleDistance(current, aisle);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = aisle;
                }
            });

            route.push(nearest);
            unvisited.delete(nearest);
        }

        return route;
    }

    getAisleDistance(aisle1, aisle2) {
        // Simple Manhattan distance between aisles
        return Math.abs(aisle2 - aisle1);
    }

    renderRouteSteps(itemsByAisle) {
        const stepsContainer = document.getElementById('route-steps');
        stepsContainer.innerHTML = this.currentRoute
            .map(aisleId => `
                <div class="route-step">
                    <h4>Aisle ${aisleId}</h4>
                    <ul>
                        ${itemsByAisle.get(aisleId)
                            .map(item => `<li>${item}</li>`)
                            .join('')}
                    </ul>
                </div>
            `).join('');
    }

    toggleItem(itemName) {
        const item = this.groceryList.get(itemName);
        if (item) {
            item.collected = !item.collected;
            this.renderGroceryList();
        }
    }
}

// Add styles
const styles = `
    .grocery-optimizer {
        display: grid;
        grid-template-columns: 300px 1fr;
        gap: 20px;
        padding: 20px;
        max-width: 1200px;
        margin: 0 auto;
    }
    .input-section {
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .map-section {
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .grocery-list {
        margin-top: 20px;
    }
    .list-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px;
        border-bottom: 1px solid #eee;
    }
    .list-item.collected {
        opacity: 0.5;
        text-decoration: line-through;
    }
    .store-map {
        height: 600px;
        border: 1px solid #ccc;
        margin-bottom: 20px;
    }
    .aisle {
        fill: #f0f0f0;
        stroke: #ccc;
    }
    .aisle.highlighted {
        fill: #e3f2fd;
        stroke: #2196F3;
    }
    .route-path {
        fill: none;
        stroke: #4CAF50;
        stroke-width: 2;
        stroke-dasharray: 4;
    }
    .route-step {
        margin-bottom: 15px;
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// Initialize
const groceryOptimizer = new GroceryListOptimizer();
groceryOptimizer.init();
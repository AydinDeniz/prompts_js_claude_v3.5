class ResponsiveBarChart {
  constructor(config) {
    this.config = {
      container: '#chart',
      margin: { top: 40, right: 20, bottom: 60, left: 60 },
      barColor: '#4682b4',
      hoverColor: '#2e5c84',
      animationDuration: 750,
      tooltipFormat: d => `${d.category}: ${d.value}`,
      ...config
    };

    this.init();
  }

  init() {
    this.container = d3.select(this.config.container);
    this.setupSvg();
    this.setupScales();
    this.setupAxes();
    this.setupTooltip();
  }

  setupSvg() {
    this.svg = this.container
      .append('svg')
      .attr('class', 'bar-chart')
      .style('width', '100%')
      .style('height', '100%');

    this.chart = this.svg.append('g')
      .attr('class', 'chart-group');

    // Add title
    this.svg.append('text')
      .attr('class', 'chart-title')
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('font-weight', 'bold')
      .text(this.config.title || '');
  }

  setupScales() {
    this.xScale = d3.scaleBand().padding(0.1);
    this.yScale = d3.scaleLinear();
  }

  setupAxes() {
    this.xAxis = this.chart.append('g')
      .attr('class', 'x-axis');

    this.yAxis = this.chart.append('g')
      .attr('class', 'y-axis');

    // Add axis labels
    this.chart.append('text')
      .attr('class', 'x-axis-label')
      .style('text-anchor', 'middle')
      .text(this.config.xAxisLabel || '');

    this.chart.append('text')
      .attr('class', 'y-axis-label')
      .style('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .text(this.config.yAxisLabel || '');
  }

  setupTooltip() {
    this.tooltip = d3.select('body')
      .append('div')
      .attr('class', 'chart-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background-color', 'rgba(0,0,0,0.8)')
      .style('color', 'white')
      .style('padding', '8px')
      .style('border-radius', '4px')
      .style('font-size', '12px');
  }

  updateDimensions() {
    const containerRect = this.container.node().getBoundingClientRect();
    this.width = containerRect.width - this.config.margin.left - this.config.margin.right;
    this.height = containerRect.height - this.config.margin.top - this.config.margin.bottom;

    this.svg
      .attr('viewBox', `0 0 ${containerRect.width} ${containerRect.height}`);

    this.chart
      .attr('transform', `translate(${this.config.margin.left},${this.config.margin.top})`);

    // Update scales
    this.xScale.rangeRound([0, this.width]);
    this.yScale.rangeRound([this.height, 0]);

    // Update axis labels
    this.chart.select('.x-axis-label')
      .attr('transform', `translate(${this.width/2},${this.height + 40})`);

    this.chart.select('.y-axis-label')
      .attr('transform', `rotate(-90) translate(${-this.height/2},-40)`);

    // Update chart title
    this.svg.select('.chart-title')
      .attr('transform', `translate(${containerRect.width/2},20)`);
  }

  update(data) {
    this.data = data;
    this.updateDimensions();
    this.updateScales();
    this.updateAxes();
    this.updateBars();
  }

  updateScales() {
    this.xScale.domain(this.data.map(d => d.category));
    this.yScale.domain([0, d3.max(this.data, d => d.value)]);
  }

  updateAxes() {
    const xAxis = d3.axisBottom(this.xScale);
    const yAxis = d3.axisLeft(this.yScale);

    this.xAxis
      .attr('transform', `translate(0,${this.height})`)
      .transition()
      .duration(this.config.animationDuration)
      .call(xAxis)
      .selectAll('text')
      .style('text-anchor', 'end')
      .attr('dx', '-.8em')
      .attr('dy', '.15em')
      .attr('transform', 'rotate(-45)');

    this.yAxis
      .transition()
      .duration(this.config.animationDuration)
      .call(yAxis);
  }

  updateBars() {
    // Data join
    const bars = this.chart.selectAll('.bar')
      .data(this.data, d => d.category);

    // Exit
    bars.exit()
      .transition()
      .duration(this.config.animationDuration)
      .attr('y', this.height)
      .attr('height', 0)
      .remove();

    // Enter
    const barsEnter = bars.enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('y', this.height)
      .attr('height', 0);

    // Update + Enter
    bars.merge(barsEnter)
      .style('fill', this.config.barColor)
      .attr('x', d => this.xScale(d.category))
      .attr('width', this.xScale.bandwidth())
      .transition()
      .duration(this.config.animationDuration)
      .attr('y', d => this.yScale(d.value))
      .attr('height', d => this.height - this.yScale(d.value));

    // Add hover effects and tooltips
    this.addInteractivity(bars.merge(barsEnter));
  }

  addInteractivity(bars) {
    bars
      .on('mouseover', (event, d) => {
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .style('fill', this.config.hoverColor);

        this.tooltip
          .style('visibility', 'visible')
          .html(this.config.tooltipFormat(d));
      })
      .on('mousemove', (event) => {
        this.tooltip
          .style('top', (event.pageY - 10) + 'px')
          .style('left', (event.pageX + 10) + 'px');
      })
      .on('mouseout', (event) => {
        d3.select(event.currentTarget)
          .transition()
          .duration(200)
          .style('fill', this.config.barColor);

        this.tooltip.style('visibility', 'hidden');
      });
  }
}

// Example usage:
const sampleData = [
  { category: 'A', value: 10 },
  { category: 'B', value: 20 },
  { category: 'C', value: 15 },
  { category: 'D', value: 25 },
  { category: 'E', value: 30 }
];

const chart = new ResponsiveBarChart({
  container: '#chart',
  title: 'Sample Bar Chart',
  xAxisLabel: 'Categories',
  yAxisLabel: 'Values',
  tooltipFormat: d => `Category: ${d.category}<br>Value: ${d.value}`,
  barColor: '#4682b4',
  hoverColor: '#2e5c84'
});

chart.update(sampleData);

// Handle window resize
window.addEventListener('resize', () => {
  chart.update(sampleData);
});

// Example of dynamic data update
setTimeout(() => {
  const newData = sampleData.map(d => ({
    ...d,
    value: Math.random() * 50
  }));
  chart.update(newData);
}, 3000);

// CSS styles
`
.chart-tooltip {
  pointer-events: none;
  z-index: 1000;
}

.bar {
  transition: fill 0.2s;
}

.x-axis path,
.y-axis path,
.x-axis line,
.y-axis line {
  stroke: #ccc;
}

.x-axis text,
.y-axis text {
  font-size: 12px;
}

.x-axis-label,
.y-axis-label {
  font-size: 14px;
  fill: #666;
}

.chart-title {
  font-size: 16px;
  fill: #333;
}
`

// HTML container
`
<div id="chart" style="width: 100%; height: 500px;"></div>
`
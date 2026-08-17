import React from 'react';

// Mirrors the node palette colors in styles.css (.fc-pal-*, .fc-canvas-shape.fc-*)
// so a thumbnail reads consistently with the real canvas.
const TYPE_COLORS = {
  start: 'var(--accent-gold)',
  action: 'var(--accent-blue)',
  decision: 'var(--success)',
  note: 'var(--text-secondary)',
  draft: 'var(--accent-gold)'
};

// Flowcharts saved before node positions existed have no x/y. The real canvas
// handles this with a BFS auto-layout; a thumbnail doesn't need anything that
// elaborate, just something that doesn't stack every node at (0,0).
function layoutFallback(nodes) {
  const cols = 4;
  return nodes.map((n, i) => ({
    ...n,
    x: n.x ?? (i % cols) * 260,
    y: n.y ?? Math.floor(i / cols) * 160,
    width: n.width || 220,
    height: n.height || 80
  }));
}

// Renders a small static SVG map of a flowchart's shapes and connections —
// not a screenshot of the real canvas (no champion art, no text), just enough
// structure to recognize which saved flowchart is which at a glance.
function FlowchartThumbnail({ data, height = 90 }) {
  let parsed = null;
  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    parsed = null;
  }

  const rawNodes = parsed?.nodes || [];
  const edges = parsed?.edges || [];

  if (rawNodes.length === 0) {
    return (
      <div className="fc-thumb-empty" style={{ height }}>
        Empty flowchart
      </div>
    );
  }

  const nodes = layoutFallback(rawNodes);
  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));

  const pad = 20;
  const minX = Math.min(...nodes.map(n => n.x));
  const minY = Math.min(...nodes.map(n => n.y));
  const maxX = Math.max(...nodes.map(n => n.x + n.width));
  const maxY = Math.max(...nodes.map(n => n.y + n.height));
  const w = (maxX - minX) + pad * 2;
  const h = (maxY - minY) + pad * 2;

  return (
    <svg className="fc-thumb" viewBox={`0 0 ${w} ${h}`} style={{ height, width: '100%' }} preserveAspectRatio="xMidYMid meet">
      {edges.map((edge, i) => {
        const from = nodeById[edge.from];
        const to = nodeById[edge.to];
        if (!from || !to) return null;
        return (
          <line
            key={i}
            x1={from.x - minX + pad + from.width / 2}
            y1={from.y - minY + pad + from.height / 2}
            x2={to.x - minX + pad + to.width / 2}
            y2={to.y - minY + pad + to.height / 2}
            stroke="var(--border-color)"
            strokeWidth="2"
          />
        );
      })}
      {nodes.map(n => (
        <rect
          key={n.id}
          x={n.x - minX + pad}
          y={n.y - minY + pad}
          width={n.width}
          height={n.height}
          rx="6"
          fill={TYPE_COLORS[n.type] || 'var(--text-secondary)'}
          fillOpacity="0.22"
          stroke={TYPE_COLORS[n.type] || 'var(--text-secondary)'}
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}

export default FlowchartThumbnail;

import React, { useState, useRef, useCallback, useEffect } from 'react';
import html2canvas from 'html2canvas';

const NODE_TYPES = ['start', 'action', 'decision', 'note'];

// Display names only. The underlying type keys stay as-is so previously saved
// flowcharts keep rendering and the fc-pal-*/fc-shape-* CSS classes still match.
const NODE_TYPE_LABELS = {
  start: 'Bans',
  action: 'Picks',
  decision: 'Alternatives',
  note: 'Note'
};
const labelFor = (type) => NODE_TYPE_LABELS[type] || type;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Auto-layout for old flowcharts without x/y coordinates (BFS tree)
function autoLayout(nodes, edges) {
  if (!nodes || nodes.length === 0) return nodes;
  if (nodes.every(n => n.x !== undefined && n.y !== undefined)) return nodes;

  const childIds = new Set(edges.map(e => e.to));
  const rootId = nodes.find(n => !childIds.has(n.id))?.id || nodes[0].id;

  const levels = {};
  const visited = new Set();
  const queue = [{ id: rootId, level: 0, index: 0 }];
  visited.add(rootId);

  while (queue.length > 0) {
    const { id, level } = queue.shift();
    if (!levels[level]) levels[level] = [];
    levels[level].push(id);

    const children = edges.filter(e => e.from === id).map(e => e.to);
    for (const childId of children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push({ id: childId, level: level + 1 });
      }
    }
  }

  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = { ...n }; });

  Object.entries(levels).forEach(([level, ids]) => {
    const y = 80 + parseInt(level) * 160;
    const totalWidth = ids.length * 260;
    const startX = Math.max(100, 400 - totalWidth / 2);
    ids.forEach((id, i) => {
      if (nodeMap[id].x === undefined) nodeMap[id].x = startX + i * 260;
      if (nodeMap[id].y === undefined) nodeMap[id].y = y;
    });
  });

  nodes.forEach((n, i) => {
    if (nodeMap[n.id].x === undefined) {
      nodeMap[n.id].x = 100 + (i % 4) * 260;
      nodeMap[n.id].y = 80 + Math.floor(i / 4) * 160;
    }
  });

  return Object.values(nodeMap);
}

// Default sizes per node type
const NODE_DEFAULTS = {
  start:    { width: 160, height: 100 },
  action:   { width: 220, height: 80 },
  decision: { width: 180, height: 140 },
  note:     { width: 220, height: 80 },
  draft:    { width: 320, height: 160 }
};

function getNodeSize(type) {
  return NODE_DEFAULTS[type] || NODE_DEFAULTS.action;
}

// Migrate old championId → championIds array
function migrateNode(n) {
  const node = { ...n };
  if (node.championId && !node.championIds) {
    node.championIds = [node.championId];
    delete node.championId;
  }
  if (!node.championIds) node.championIds = [];
  // Upgrade old smaller sizes to new defaults
  const defaults = getNodeSize(node.type);
  if (!node.width || node.width <= 160) node.width = defaults.width;
  if (!node.height || node.height <= 80) node.height = defaults.height;
  return node;
}

// Get port position on a node
function getPortPos(node, port) {
  const w = node.width || 220;
  const h = node.height || 80;
  switch (port) {
    case 'top':    return { x: node.x + w / 2, y: node.y };
    case 'bottom': return { x: node.x + w / 2, y: node.y + h };
    case 'left':   return { x: node.x,         y: node.y + h / 2 };
    case 'right':  return { x: node.x + w,     y: node.y + h / 2 };
    default:       return { x: node.x + w / 2, y: node.y + h };
  }
}

// Compute bezier path between two points, with control points extending
// outward from each port direction for clean curves
function bezierPath(fromPos, toPos, fromPort, toPort) {
  const dist = Math.hypot(toPos.x - fromPos.x, toPos.y - fromPos.y);
  const tension = Math.max(40, Math.min(dist * 0.4, 120));

  const portDir = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
  const fd = portDir[fromPort] || [0, 1];
  const td = portDir[toPort] || [0, -1];

  const c1x = fromPos.x + fd[0] * tension;
  const c1y = fromPos.y + fd[1] * tension;
  const c2x = toPos.x + td[0] * tension;
  const c2y = toPos.y + td[1] * tension;

  return `M${fromPos.x},${fromPos.y} C${c1x},${c1y} ${c2x},${c2y} ${toPos.x},${toPos.y}`;
}

// Determine the best port on `node` that faces toward `otherNode`
function bestPort(node, otherNode) {
  const nw = node.width || 220;
  const nh = node.height || 80;
  const ow = otherNode.width || 220;
  const oh = otherNode.height || 80;
  const ncx = node.x + nw / 2;
  const ncy = node.y + nh / 2;
  const ocx = otherNode.x + ow / 2;
  const ocy = otherNode.y + oh / 2;

  const dx = ocx - ncx;
  const dy = ocy - ncy;

  if (Math.abs(dy) > Math.abs(dx)) {
    return dy > 0 ? 'bottom' : 'top';
  } else {
    return dx > 0 ? 'right' : 'left';
  }
}

function FlowchartCanvas({
  teamId,
  flowcharts,
  drafts,
  initialFlowchart,
  champions,
  version,
  enemyPlayers,
  onSave,
  onDelete,
  onClose
}) {
  // Drafts sidebar
  const [selectedFcId, setSelectedFcId] = useState(initialFlowchart?.id || null);
  const [fcName, setFcName] = useState(initialFlowchart?.name || '');

  // Canvas data
  const [nodes, setNodes] = useState(() => {
    if (initialFlowchart) {
      const data = typeof initialFlowchart.data === 'string' ? JSON.parse(initialFlowchart.data) : initialFlowchart.data;
      return autoLayout(data.nodes || [], data.edges || []).map(migrateNode);
    }
    const startId = generateId();
    return [{ id: startId, type: 'start', text: 'Bans', x: 350, y: 80, width: 160, height: 100, championIds: [] }];
  });
  const [edges, setEdges] = useState(() => {
    if (initialFlowchart) {
      const data = typeof initialFlowchart.data === 'string' ? JSON.parse(initialFlowchart.data) : initialFlowchart.data;
      return data.edges || [];
    }
    return [];
  });

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null); // { from, to }

  // Canvas interaction state
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [drawingEdge, setDrawingEdge] = useState(null);
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  // Champion sidebar
  const [champSearch, setChampSearch] = useState('');
  // eslint-disable-next-line no-unused-vars
  const [champDragging, setChampDragging] = useState(null);

  // Right-click champion context menu
  const [contextMenu, setContextMenu] = useState(null); // { nodeId, x, y }
  const [contextSearch, setContextSearch] = useState('');

  // Save feedback
  const [saveStatus, setSaveStatus] = useState(''); // '', 'saving', 'saved', 'error'

  // Insert draft dropdown
  const [showDraftMenu, setShowDraftMenu] = useState(false);

  const canvasRef = useRef(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Load a flowchart from the sidebar list
  const loadFlowchart = useCallback((fc) => {
    const data = typeof fc.data === 'string' ? JSON.parse(fc.data) : fc.data;
    setSelectedFcId(fc.id);
    setFcName(fc.name);
    setNodes(autoLayout(data.nodes || [], data.edges || []).map(migrateNode));
    setEdges(data.edges || []);
    setSelectedNodeId(null);
  }, []);

  const handleNewFlowchart = () => {
    const startId = generateId();
    setSelectedFcId(null);
    setFcName('');
    setNodes([{ id: startId, type: 'start', text: 'Bans', x: 350, y: 80, width: 160, height: 100, championIds: [] }]);
    setEdges([]);
    setSelectedNodeId(null);
  };

  const handleSave = async () => {
    if (!fcName.trim()) {
      setSaveStatus('noname');
      setTimeout(() => setSaveStatus(''), 4000);
      return;
    }
    setSaveStatus('saving');
    try {
      const payload = {
        name: fcName,
        data: { nodes, edges }
      };
      const savedFc = await onSave(selectedFcId, payload);
      if (savedFc && savedFc.id) {
        setSelectedFcId(savedFc.id);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(''), 4000);
      } else {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus(''), 5000);
      }
    } catch (err) {
      console.error('Flowchart save error:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 5000);
    }
  };

  // ---- Canvas mouse handlers ----
  const getCanvasPoint = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (e.clientX - rect.left - canvasOffset.x) / zoom,
      y: (e.clientY - rect.top - canvasOffset.y) / zoom
    };
  }, [canvasOffset, zoom]);

  const handleCanvasMouseDown = (e) => {
    if (e.target === canvasRef.current || e.target.classList.contains('fc-canvas-inner') || e.target.tagName === 'svg') {
      setSelectedNodeId(null);
      setSelectedEdge(null);
      setPanning(true);
      setPanStart({ x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y });
    }
  };

  const handleCanvasMouseMove = useCallback((e) => {
    if (panning) {
      setCanvasOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
      return;
    }

    if (draggingNodeId) {
      const point = getCanvasPoint(e);
      setNodes(prev => prev.map(n =>
        n.id === draggingNodeId
          ? { ...n, x: point.x - dragOffset.x, y: point.y - dragOffset.y }
          : n
      ));
      return;
    }

    if (drawingEdge) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDrawingEdge(prev => ({
        ...prev,
        mouseX: (e.clientX - rect.left - canvasOffset.x) / zoom,
        mouseY: (e.clientY - rect.top - canvasOffset.y) / zoom
      }));
    }
  }, [panning, panStart, draggingNodeId, dragOffset, drawingEdge, getCanvasPoint, canvasOffset, zoom]);

  const handleCanvasMouseUp = useCallback((e) => {
    if (panning) {
      setPanning(false);
      return;
    }

    if (draggingNodeId) {
      setDraggingNodeId(null);
      return;
    }

    if (drawingEdge) {
      const point = getCanvasPoint(e);
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      // Find closest node to drop point within generous hit area
      let bestTarget = null;
      let bestDist = Infinity;
      for (const n of currentNodes) {
        if (n.id === drawingEdge.fromNodeId) continue;
        const w = n.width || 220;
        const h = n.height || 80;
        const cx = n.x + w / 2;
        const cy = n.y + h / 2;
        // Check if point is within padded bounding box
        if (point.x >= n.x - 25 && point.x <= n.x + w + 25 &&
            point.y >= n.y - 25 && point.y <= n.y + h + 25) {
          const dist = Math.hypot(point.x - cx, point.y - cy);
          if (dist < bestDist) {
            bestDist = dist;
            bestTarget = n;
          }
        }
      }

      if (bestTarget) {
        const exists = currentEdges.some(e => e.from === drawingEdge.fromNodeId && e.to === bestTarget.id);
        if (!exists) {
          // Determine best receiving port on target based on cursor position
          const tw = bestTarget.width || 220;
          const th = bestTarget.height || 80;
          const tcx = bestTarget.x + tw / 2;
          const tcy = bestTarget.y + th / 2;
          const tdx = point.x - tcx;
          const tdy = point.y - tcy;
          const toPort = Math.abs(tdy) > Math.abs(tdx)
            ? (tdy > 0 ? 'bottom' : 'top')
            : (tdx > 0 ? 'right' : 'left');
          setEdges(prev => [...prev, {
            from: drawingEdge.fromNodeId,
            to: bestTarget.id,
            fromPort: drawingEdge.fromPort,
            toPort: toPort,
            label: ''
          }]);
        }
      }
      setDrawingEdge(null);
    }
  }, [panning, draggingNodeId, drawingEdge, getCanvasPoint]);

  useEffect(() => {
    const handleMouseUp = (e) => handleCanvasMouseUp(e);
    const handleMouseMove = (e) => handleCanvasMouseMove(e);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleCanvasMouseUp, handleCanvasMouseMove]);

  // Mouse wheel zoom (pinch-to-zoom on trackpad)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const oldZoom = zoomRef.current;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(3, Math.max(0.2, oldZoom * delta));

      // Zoom toward cursor position
      setCanvasOffset(prev => ({
        x: mouseX - (mouseX - prev.x) * (newZoom / oldZoom),
        y: mouseY - (mouseY - prev.y) * (newZoom / oldZoom)
      }));
      setZoom(newZoom);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  const handleZoomIn = () => setZoom(z => Math.min(3, z * 1.2));
  const handleZoomOut = () => setZoom(z => Math.max(0.2, z / 1.2));
  const handleZoomReset = () => { setZoom(1); setCanvasOffset({ x: 0, y: 0 }); };

  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    const canvasInner = canvasRef.current?.querySelector('.fc-canvas-inner');
    if (!canvasInner) return;
    setExporting(true);

    // Calculate tight bounding box around all nodes with padding
    const pad = 40;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const w = n.width || 220;
      const h = n.height || 80;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + w > maxX) maxX = n.x + w;
      if (n.y + h > maxY) maxY = n.y + h;
    });
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad - 40); // extra room for title
    const cropW = (maxX - minX) + pad * 2;
    const cropH = (maxY - minY) + pad * 2 + 40;

    try {
      // Temporarily reset transform for clean capture
      const prevTransform = canvasInner.style.transform;
      canvasInner.style.transform = 'translate(0px, 0px) scale(1)';

      // Hide interactive elements during export
      canvasInner.classList.add('fc-exporting');

      const canvas = await html2canvas(canvasInner, {
        backgroundColor: '#111111',
        x: cropX,
        y: cropY,
        width: cropW,
        height: cropH,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false
      });

      // Restore transform and classes
      canvasInner.style.transform = prevTransform;
      canvasInner.classList.remove('fc-exporting');

      // Draw title + watermark on the captured image
      const ctx = canvas.getContext('2d');
      const title = fcName || 'Flowchart';
      ctx.fillStyle = 'rgba(17, 17, 17, 0.75)';
      ctx.fillRect(0, 0, canvas.width, 64);
      ctx.font = 'bold 28px Segoe UI, sans-serif';
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(title, 20, 42);
      // Small watermark
      ctx.font = '14px Segoe UI, sans-serif';
      ctx.fillStyle = 'rgba(168, 162, 158, 0.5)';
      ctx.fillText('IQ Scouting', canvas.width - 110, canvas.height - 12);

      // Download
      const link = document.createElement('a');
      link.download = `${(fcName || 'flowchart').replace(/[^a-zA-Z0-9]/g, '_')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
      // Ensure cleanup in case of error
      canvasInner.classList.remove('fc-exporting');
    }
  };

  // Node drag
  const handleNodeMouseDown = (e, nodeId) => {
    e.stopPropagation();
    const point = getCanvasPoint(e);
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    setDraggingNodeId(nodeId);
    setDragOffset({ x: point.x - node.x, y: point.y - node.y });
    setSelectedNodeId(nodeId);
    setSelectedEdge(null);
  };

  // Port drag (start drawing edge)
  const handlePortMouseDown = (e, nodeId, port) => {
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDrawingEdge({
      fromNodeId: nodeId,
      fromPort: port,
      mouseX: (e.clientX - rect.left - canvasOffset.x) / zoom,
      mouseY: (e.clientY - rect.top - canvasOffset.y) / zoom
    });
  };

  // Palette / champion drop on canvas
  const handleCanvasDrop = (e) => {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData('nodeType');
    const champId = e.dataTransfer.getData('championId');

    if (nodeType) {
      const point = getCanvasPoint(e);
      const newId = generateId();
      const sz = getNodeSize(nodeType);
      setNodes(prev => [...prev, {
        id: newId, type: nodeType, text: '', x: point.x - sz.width / 2, y: point.y - sz.height / 2,
        width: sz.width, height: sz.height, championIds: []
      }]);
      setSelectedNodeId(newId);
    } else if (champId) {
      // Dropping a champion onto the canvas — find if over a node
      const point = getCanvasPoint(e);
      const targetNode = nodes.find(n => {
        const w = n.width || 220;
        const h = n.height || 80;
        return point.x >= n.x && point.x <= n.x + w &&
               point.y >= n.y && point.y <= n.y + h;
      });
      if (targetNode) {
        setNodes(prev => prev.map(n => {
          if (n.id !== targetNode.id) return n;
          const ids = n.championIds || [];
          return ids.includes(champId) ? n : { ...n, championIds: [...ids, champId] };
        }));
        setSelectedNodeId(targetNode.id);
      }
    }
  };

  const handleCanvasDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  // Also handle champion drop directly on node shapes
  const handleNodeDrop = (e, nodeId) => {
    e.preventDefault();
    e.stopPropagation();
    const champId = e.dataTransfer.getData('championId');
    if (champId) {
      setNodes(prev => prev.map(n => {
        if (n.id !== nodeId) return n;
        const ids = n.championIds || [];
        return ids.includes(champId) ? n : { ...n, championIds: [...ids, champId] };
      }));
      setSelectedNodeId(nodeId);
    }
  };

  const handleNodeDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  // Right-click context menu for adding champions
  const handleNodeContextMenu = (e, nodeId) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ nodeId, x: e.clientX, y: e.clientY });
    setContextSearch('');
  };

  const handleContextChampSelect = (champId) => {
    if (!contextMenu) return;
    setNodes(prev => prev.map(n => {
      if (n.id !== contextMenu.nodeId) return n;
      const ids = n.championIds || [];
      return ids.includes(champId) ? n : { ...n, championIds: [...ids, champId] };
    }));
    setContextMenu(null);
    setContextSearch('');
  };

  const filteredContextChampions = champions.filter(c =>
    !contextSearch || c.name.toLowerCase().includes(contextSearch.toLowerCase())
  );

  // Insert a saved draft as a node on the canvas
  const parsePicks = (str) => {
    try { return JSON.parse(str).filter(Boolean); } catch { return []; }
  };

  const handleInsertDraft = (draft) => {
    setShowDraftMenu(false);
    const newId = generateId();
    const sz = getNodeSize('draft');
    // Place in visible area
    const x = (-canvasOffset.x / zoom) + 100;
    const y = (-canvasOffset.y / zoom) + 100;
    setNodes(prev => [...prev, {
      id: newId,
      type: 'draft',
      text: draft.name,
      x, y,
      width: sz.width,
      height: sz.height,
      championIds: [],
      draftData: {
        bluePicks: parsePicks(draft.blue_picks),
        redPicks: parsePicks(draft.red_picks),
        blueBans: parsePicks(draft.blue_bans),
        redBans: parsePicks(draft.red_bans)
      }
    }]);
    setSelectedNodeId(newId);
  };

  // Import enemy players as nodes
  const handleImportPlayers = () => {
    if (!enemyPlayers || enemyPlayers.length === 0) return;

    const roleOrder = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
    const sorted = [...enemyPlayers].sort((a, b) => {
      const ai = roleOrder.indexOf(a.role);
      const bi = roleOrder.indexOf(b.role);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const startX = (-canvasOffset.x / zoom) + 100;
    const startY = (-canvasOffset.y / zoom) + 100;
    const spacing = 120;

    const newNodes = sorted.map((player, i) => {
      const topChamps = player.top_champions ? JSON.parse(player.top_champions) : [];
      const champIds = topChamps.map(c => c.championName).filter(Boolean);
      const roleLabel = player.role || 'Unknown';
      const sz = getNodeSize('action');

      return {
        id: generateId(),
        type: 'action',
        text: `${roleLabel}: ${player.game_name}`,
        x: startX,
        y: startY + i * spacing,
        width: sz.width,
        height: sz.height,
        championIds: champIds
      };
    });

    setNodes(prev => [...prev, ...newNodes]);
  };

  // Node editing
  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  const updateNodeField = (field, value) => {
    setNodes(prev => prev.map(n => n.id === selectedNodeId ? { ...n, [field]: value } : n));
  };

  const deleteNode = () => {
    if (!selectedNodeId || nodes.length <= 1) return;
    setNodes(prev => prev.filter(n => n.id !== selectedNodeId));
    setEdges(prev => prev.filter(e => e.from !== selectedNodeId && e.to !== selectedNodeId));
    setSelectedNodeId(null);
  };

  const deleteEdge = (from, to) => {
    setEdges(prev => prev.filter(e => !(e.from === from && e.to === to)));
  };

  // Champion helpers
  const filteredChampions = champions.filter(c =>
    !champSearch || c.name.toLowerCase().includes(champSearch.toLowerCase())
  );

  const getChampionImage = (champId) => {
    if (!champId || !version) return null;
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champId}.png`;
  };

  // Compute SVG bounds
  const svgWidth = Math.max(2000, ...nodes.map(n => (n.x || 0) + (n.width || 220) + 200));
  const svgHeight = Math.max(2000, ...nodes.map(n => (n.y || 0) + (n.height || 80) + 200));

  return (
    <div className="fc-canvas-overlay">
      {/* Left Sidebar - Saved Flowcharts */}
      <div className="fc-drafts-sidebar">
        <h3 style={{ color: 'var(--accent-gold)', margin: '0 0 1rem 0' }}>Flowcharts</h3>
        <button className="btn btn-primary btn-small" onClick={handleNewFlowchart} style={{ width: '100%', marginBottom: '1rem' }}>
          + New Flowchart
        </button>
        <div className="fc-drafts-list">
          {flowcharts.map(fc => (
            <div
              key={fc.id}
              className={`fc-draft-item ${selectedFcId === fc.id ? 'active' : ''}`}
              onClick={() => loadFlowchart(fc)}
            >
              <span className="fc-draft-name">{fc.name}</span>
              <button
                className="fc-draft-delete"
                onClick={(e) => { e.stopPropagation(); onDelete(fc.id); }}
                title="Delete"
              >
                ×
              </button>
            </div>
          ))}
          {flowcharts.length === 0 && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No saved flowcharts.</p>
          )}
        </div>
      </div>

      {/* Main Editor Area */}
      <div className="fc-editor-main">
        {/* Top Toolbar */}
        <div className="fc-toolbar">
          <div className="fc-toolbar-left">
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginRight: '-0.25rem' }}>Name:</label>
            <input
              type="text"
              value={fcName}
              onChange={(e) => setFcName(e.target.value)}
              placeholder="Enter flowchart name..."
              className="fc-name-input"
              style={!fcName.trim() ? { borderColor: 'var(--warning)' } : {}}
            />
            <div className="fc-palette">
              {NODE_TYPES.map(type => (
                <div
                  key={type}
                  className={`fc-palette-item fc-pal-${type}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('nodeType', type);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  title={`Drag to add a ${labelFor(type)} node`}
                >
                  {labelFor(type)}
                </div>
              ))}
            </div>
            {drafts && drafts.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => setShowDraftMenu(!showDraftMenu)}
                >
                  Insert Draft
                </button>
                {showDraftMenu && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setShowDraftMenu(false)} />
                    <div className="fc-draft-dropdown">
                      {drafts.map(d => (
                        <div
                          key={d.id}
                          className="fc-draft-dropdown-item"
                          onClick={() => handleInsertDraft(d)}
                        >
                          {d.name}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {enemyPlayers && enemyPlayers.length > 0 && (
              <button
                className="btn btn-secondary btn-small"
                onClick={handleImportPlayers}
                title="Add enemy player nodes to the canvas"
              >
                Import Players
              </button>
            )}
          </div>
          <div className="fc-toolbar-right">
            <div className="fc-zoom-controls">
              <button className="fc-zoom-btn" onClick={handleZoomOut} title="Zoom out">-</button>
              <button className="fc-zoom-label" onClick={handleZoomReset} title="Reset zoom">
                {Math.round(zoom * 100)}%
              </button>
              <button className="fc-zoom-btn" onClick={handleZoomIn} title="Zoom in">+</button>
            </div>
            <button
              className="btn btn-primary btn-small"
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? 'Saving...' : 'Save'}
            </button>
            <button
              className="btn btn-secondary btn-small"
              onClick={handleExport}
              disabled={exporting}
              title="Export as PNG for Discord"
            >
              {exporting ? 'Exporting...' : 'Export PNG'}
            </button>
            {saveStatus === 'saved' && (
              <span className="fc-save-feedback success">Saved successfully!</span>
            )}
            {saveStatus === 'error' && (
              <span className="fc-save-feedback error">Failed to save - check console</span>
            )}
            {saveStatus === 'noname' && (
              <span className="fc-save-feedback error">Enter a name first</span>
            )}
            <button className="btn btn-secondary btn-small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {/* Canvas + Champion sidebar wrapper */}
        <div className="fc-canvas-wrapper">
          {/* Canvas Area */}
          <div
            className="fc-canvas-area"
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onDrop={handleCanvasDrop}
            onDragOver={handleCanvasDragOver}
          >
            <div
              className="fc-canvas-inner"
              style={{
                transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                width: svgWidth,
                height: svgHeight
              }}
            >
              {/* SVG Overlay for arrows */}
              <svg className="fc-svg-overlay" width={svgWidth} height={svgHeight}>
                <defs>
                  <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="var(--accent-gold)" />
                  </marker>
                </defs>
                {edges.map((edge, i) => {
                  const fromNode = nodes.find(n => n.id === edge.from);
                  const toNode = nodes.find(n => n.id === edge.to);
                  if (!fromNode || !toNode) return null;

                  const fromPort = edge.fromPort || bestPort(fromNode, toNode);
                  const toPort = edge.toPort || bestPort(toNode, fromNode);
                  const from = getPortPos(fromNode, fromPort);
                  const to = getPortPos(toNode, toPort);
                  const path = bezierPath(from, to, fromPort, toPort);

                  const midX = (from.x + to.x) / 2;
                  const midY = (from.y + to.y) / 2;
                  const isSelected = selectedEdge && selectedEdge.from === edge.from && selectedEdge.to === edge.to;

                  return (
                    <g key={i}>
                      <path d={path} fill="none" stroke={isSelected ? 'var(--accent-gold)' : 'var(--border-color)'} strokeWidth={isSelected ? 3 : 2} markerEnd="url(#arrowhead)" />
                      <path
                        d={path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth="16"
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); setSelectedEdge({ from: edge.from, to: edge.to }); setSelectedNodeId(null); }}
                        title="Click to edit label"
                      />
                      {edge.label && (
                        <g>
                          <rect
                            x={midX - edge.label.length * 3.5 - 6}
                            y={midY - 18}
                            width={edge.label.length * 7 + 12}
                            height={20}
                            rx="4"
                            fill="var(--bg-secondary)"
                            opacity="0.9"
                          />
                          <text
                            x={midX}
                            y={midY - 5}
                            textAnchor="middle"
                            fill="var(--accent-gold)"
                            fontSize="12"
                            fontWeight="600"
                          >
                            {edge.label}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* Preview line while drawing */}
                {drawingEdge && (() => {
                  const fromNode = nodes.find(n => n.id === drawingEdge.fromNodeId);
                  if (!fromNode) return null;
                  const from = getPortPos(fromNode, drawingEdge.fromPort);
                  const to = { x: drawingEdge.mouseX, y: drawingEdge.mouseY };
                  const path = bezierPath(from, to, drawingEdge.fromPort, 'top');
                  return (
                    <path d={path} fill="none" stroke="var(--accent-gold)" strokeWidth="2" strokeDasharray="6,3" opacity="0.7" />
                  );
                })()}
              </svg>

              {/* Shape nodes */}
              {nodes.map(node => (
                <div
                  key={node.id}
                  className={`fc-canvas-shape fc-${node.type} ${selectedNodeId === node.id ? 'selected' : ''}`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.width || 220,
                    minHeight: node.height || 80
                  }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                  onDrop={(e) => handleNodeDrop(e, node.id)}
                  onDragOver={handleNodeDragOver}
                >
                  {node.type === 'draft' && node.draftData ? (
                    <div className="fc-draft-node-content">
                      <div className="fc-draft-node-title">{node.text || 'Draft'}</div>
                      <div className="fc-draft-node-row">
                        <span className="fc-draft-node-label blue">Blue:</span>
                        {node.draftData.bluePicks.map((cid, i) => (
                          <img key={`bp${i}`} className="fc-draft-node-champ" src={getChampionImage(cid)} alt={cid} title={cid} />
                        ))}
                      </div>
                      <div className="fc-draft-node-row">
                        <span className="fc-draft-node-label red">Red:</span>
                        {node.draftData.redPicks.map((cid, i) => (
                          <img key={`rp${i}`} className="fc-draft-node-champ" src={getChampionImage(cid)} alt={cid} title={cid} />
                        ))}
                      </div>
                      {(node.draftData.blueBans.length > 0 || node.draftData.redBans.length > 0) && (
                        <div className="fc-draft-node-row bans">
                          <span className="fc-draft-node-label">Bans:</span>
                          {node.draftData.blueBans.map((cid, i) => (
                            <img key={`bb${i}`} className="fc-draft-node-champ ban" src={getChampionImage(cid)} alt={cid} title={cid} />
                          ))}
                          {node.draftData.redBans.length > 0 && <span style={{ margin: '0 2px', color: 'var(--text-secondary)', fontSize: '0.7rem' }}>|</span>}
                          {node.draftData.redBans.map((cid, i) => (
                            <img key={`rb${i}`} className="fc-draft-node-champ ban" src={getChampionImage(cid)} alt={cid} title={cid} />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {node.championIds && node.championIds.length > 0 && (
                        <div className="fc-shape-champions">
                          {node.championIds.map(cid => (
                            <img
                              key={cid}
                              className="fc-shape-champion"
                              src={getChampionImage(cid)}
                              alt={cid}
                            />
                          ))}
                        </div>
                      )}
                      <span className="fc-shape-text">{node.text || 'Empty'}</span>
                    </>
                  )}

                  {/* Port dots */}
                  {['top', 'right', 'bottom', 'left'].map(port => (
                    <div
                      key={port}
                      className={`fc-port fc-port-${port}`}
                      onMouseDown={(e) => handlePortMouseDown(e, node.id, port)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Right Sidebar - Champions */}
          <div className="fc-champ-sidebar">
            <h4 style={{ color: 'var(--accent-gold)', margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Champions</h4>
            <input
              type="text"
              value={champSearch}
              onChange={(e) => setChampSearch(e.target.value)}
              placeholder="Search..."
              className="fc-champ-search"
            />
            <div className="fc-champ-grid">
              {filteredChampions.map(c => (
                <div
                  key={c.id}
                  className="fc-champ-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('championId', c.id);
                    e.dataTransfer.effectAllowed = 'copy';
                    setChampDragging(c.id);
                  }}
                  onDragEnd={() => setChampDragging(null)}
                  title={c.name}
                >
                  <img src={c.image} alt={c.name} />
                </div>
              ))}
              {filteredChampions.length === 0 && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', gridColumn: '1/-1', textAlign: 'center', padding: '0.5rem' }}>
                  No champions found
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Node Editor Panel (bottom-right, above champ sidebar) */}
        {selectedNode && (
          <div className="fc-node-editor">
            <h4 style={{ color: 'var(--accent-gold)', margin: '0 0 0.75rem 0' }}>Edit Node</h4>
            <div style={{ marginBottom: '0.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Type</label>
              <select
                value={selectedNode.type}
                onChange={(e) => updateNodeField('type', e.target.value)}
                style={{
                  width: '100%', padding: '0.4rem', borderRadius: '4px',
                  border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)'
                }}
              >
                {NODE_TYPES.map(t => (
                  <option key={t} value={t}>{labelFor(t)}</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: '0.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Text</label>
              <input
                type="text"
                value={selectedNode.text}
                onChange={(e) => updateNodeField('text', e.target.value)}
                placeholder="Node text..."
                style={{
                  width: '100%', padding: '0.4rem', borderRadius: '4px',
                  border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)'
                }}
              />
            </div>

            {/* Edge labels for edges from this node */}
            {edges.filter(e => e.from === selectedNodeId).map(edge => {
              const targetNode = nodes.find(n => n.id === edge.to);
              return (
                <div key={edge.to} style={{ marginBottom: '0.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    Arrow to "{targetNode?.text || 'Empty'}"
                  </label>
                  <input
                    type="text"
                    value={edge.label || ''}
                    onChange={(e) => {
                      setEdges(prev => prev.map(ed =>
                        (ed.from === edge.from && ed.to === edge.to) ? { ...ed, label: e.target.value } : ed
                      ));
                    }}
                    placeholder="Label (e.g. Yes / No)"
                    style={{
                      width: '100%', padding: '0.4rem', borderRadius: '4px',
                      border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)'
                    }}
                  />
                </div>
              );
            })}

            {/* Champions on this node */}
            {selectedNode.championIds && selectedNode.championIds.length > 0 && (
              <div style={{ marginBottom: '0.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Champions</label>
                {selectedNode.championIds.map(cid => (
                  <div key={cid} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <img src={getChampionImage(cid)} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} />
                    <span style={{ fontSize: '0.85rem', flex: 1 }}>{cid}</span>
                    <button
                      className="btn btn-secondary btn-small"
                      style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}
                      onClick={() => updateNodeField('championIds', selectedNode.championIds.filter(id => id !== cid))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              {nodes.length > 1 && (
                <button className="btn btn-danger btn-small" onClick={deleteNode}>
                  Delete Node
                </button>
              )}
            </div>
          </div>
        )}

        {/* Right-click champion context menu */}
        {contextMenu && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 99 }}
              onClick={() => setContextMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
            />
            <div
              className="fc-context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <h4>Add Champion</h4>
              <input
                type="text"
                value={contextSearch}
                onChange={(e) => setContextSearch(e.target.value)}
                placeholder="Search champion..."
                autoFocus
              />
              <div className="fc-context-grid">
                {filteredContextChampions.slice(0, 40).map(c => (
                  <img
                    key={c.id}
                    src={c.image}
                    alt={c.name}
                    title={c.name}
                    onClick={() => handleContextChampSelect(c.id)}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {/* Edge Editor Panel */}
        {selectedEdge && (() => {
          const edge = edges.find(e => e.from === selectedEdge.from && e.to === selectedEdge.to);
          if (!edge) return null;
          const fromNode = nodes.find(n => n.id === edge.from);
          const toNode = nodes.find(n => n.id === edge.to);
          return (
            <div className="fc-node-editor">
              <h4 style={{ color: 'var(--accent-gold)', margin: '0 0 0.75rem 0' }}>Edit Arrow</h4>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                {fromNode?.text || 'Empty'} → {toNode?.text || 'Empty'}
              </div>
              <div style={{ marginBottom: '0.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Label</label>
                <input
                  type="text"
                  value={edge.label || ''}
                  onChange={(e) => {
                    setEdges(prev => prev.map(ed =>
                      (ed.from === edge.from && ed.to === edge.to) ? { ...ed, label: e.target.value } : ed
                    ));
                  }}
                  placeholder="e.g. Yes, No, If banned..."
                  autoFocus
                  style={{
                    width: '100%', padding: '0.4rem', borderRadius: '4px',
                    border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)'
                  }}
                />
              </div>
              <button
                className="btn btn-danger btn-small"
                onClick={() => { deleteEdge(edge.from, edge.to); setSelectedEdge(null); }}
              >
                Delete Arrow
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default FlowchartCanvas;

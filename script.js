// Добавить в начало script.js
document.addEventListener('keydown', (e) => {
  if (e.key === 'Control') {
    ctrlPressed = true;
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'Control') {
    ctrlPressed = false;
    // Скрываем пунктирное выделение при отпускании Ctrl
    if (selectionStart) {
      selectionStart = null;
      render();
    }
  }
});

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const contextMenu = document.getElementById('contextMenu');
const shapeContextMenu = document.getElementById('shapeContextMenu');
const addTriangleBtn = document.getElementById('addTriangle');
const addSquareBtn = document.getElementById('addSquare');
const addHexagonBtn = document.getElementById('addHexagon');
const splitIntoTrianglesBtn = document.getElementById('splitIntoTriangles');
const symmetryBtn = document.getElementById('symmetry');
const imageUpload = document.getElementById('imageUpload');
const imageOpacityInput = document.getElementById('imageOpacity');
const mosaicOpacityInput = document.getElementById('mosaicOpacity');
const shapeSizeInput = document.getElementById('shapeSize');
const strokeColorInput = document.getElementById('strokeColor');
const strokeWidthInput = document.getElementById('strokeWidth');
const deleteSelectedBtn = document.getElementById('deleteSelected');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const saveSVGBtn = document.getElementById('saveSVG');
const savePNGBtn = document.getElementById('savePNG');

// Настройки
canvas.width = 1200;
canvas.height = 800;
const shapes = [];
const symmetricPairs = new Map();
let isSymmetryMode = false;
let dragMode = null;
let activeShape = null;
let menuPosition = { x: 0, y: 0 };
let backgroundImage = null;
let selectionStart = null;
let lastMousePosition = { x: 0, y: 0 };
let clickedShape = null;
let ctrlPressed = false;
const SNAP_DISTANCE = 10;
const VERTEX_HIT_RADIUS = 15;

// История действий
const history = {
  states: [],
  currentIndex: -1,
  maxStates: 20,
  
  saveState() {
    this.states = this.states.slice(0, this.currentIndex + 1);
    
    const state = {
      shapes: shapes.map(shape => ({
        ...shape,
        vertices: [...shape.vertices.map(v => ({...v}))],
        isSelected: shape.isSelected
      })),
      symmetricPairs: Array.from(symmetricPairs.entries()).map(([key, value]) => [key.id, value.id])
    };
    
    this.states.push(JSON.parse(JSON.stringify(state)));
    if (this.states.length > this.maxStates) {
      this.states.shift();
    } else {
      this.currentIndex = this.states.length - 1;
    }
    
    this.updateButtons();
  },
  
  undo() {
    if (this.currentIndex <= 0) return;
    this.currentIndex--;
    this.restoreState();
  },
  
  redo() {
    if (this.currentIndex >= this.states.length - 1) return;
    this.currentIndex++;
    this.restoreState();
  },
  
  restoreState() {
    if (this.currentIndex < 0 || this.currentIndex >= this.states.length) return;
    
    const state = this.states[this.currentIndex];
    shapes.length = 0;
    symmetricPairs.clear();
    
    state.shapes.forEach(s => {
      const shape = new Shape(s.x, s.y, s.vertices, s.id);
      shape.color = s.color;
      shape.isSelected = s.isSelected;
      shapes.push(shape);
    });
    
    state.symmetricPairs.forEach(([keyId, valueId]) => {
      const shape1 = shapes.find(s => s.id === keyId);
      const shape2 = shapes.find(s => s.id === valueId);
      if (shape1 && shape2) {
        symmetricPairs.set(shape1, shape2);
        symmetricPairs.set(shape2, shape1);
      }
    });
    
    render();
    this.updateButtons();
  },
  
  updateButtons() {
    undoBtn.disabled = this.currentIndex <= 0;
    redoBtn.disabled = this.currentIndex >= this.states.length - 1;
  }
};

// Класс фигуры
class Shape {
  constructor(x, y, vertices, id = Date.now() + Math.random()) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.vertices = vertices;
    this.color = '#cccccc';
    this.isDragging = false;
    this.dragVertex = null;
    this.isSelected = false;
    this.vertexOffsets = null;
  }

  updateColor() {
    if (!backgroundImage) return;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    tempCtx.drawImage(backgroundImage, 0, 0);
    tempCtx.globalCompositeOperation = 'destination-in';
    tempCtx.fillStyle = 'black';
    tempCtx.beginPath();
    tempCtx.moveTo(this.x + this.vertices[0].x, this.y + this.vertices[0].y);
    for (let i = 1; i < this.vertices.length; i++) {
      tempCtx.lineTo(this.x + this.vertices[i].x, this.y + this.vertices[i].y);
    }
    tempCtx.closePath();
    tempCtx.fill();
    
    const pixelData = tempCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0, g = 0, b = 0, count = 0;
    
    for (let i = 0; i < pixelData.length; i += 4) {
      if (pixelData[i+3] > 0) {
        r += pixelData[i];
        g += pixelData[i+1];
        b += pixelData[i+2];
        count++;
      }
    }
    
    this.color = count > 0 
      ? `rgb(${Math.round(r/count)}, ${Math.round(g/count)}, ${Math.round(b/count)})`
      : '#cccccc';
  }

  hitTestVertex(x, y) {
    for (let i = 0; i < this.vertices.length; i++) {
      const vx = this.x + this.vertices[i].x;
      const vy = this.y + this.vertices[i].y;
      const distance = Math.sqrt((x - vx) ** 2 + (y - vy) ** 2);
      
      if (distance < VERTEX_HIT_RADIUS) return i;
    }
    return null;
  }

  hitTestEdge(x, y, threshold = 10) {
    for (let i = 0; i < this.vertices.length; i++) {
      const j = (i + 1) % this.vertices.length;
      const x1 = this.x + this.vertices[i].x;
      const y1 = this.y + this.vertices[i].y;
      const x2 = this.x + this.vertices[j].x;
      const y2 = this.y + this.vertices[j].y;
      
      const distance = distanceToLine(x, y, x1, y1, x2, y2);
      if (distance < threshold) {
        return { 
          edgeIndex: i,
          position: { 
            x: (x1 + x2) / 2 - this.x, 
            y: (y1 + y2) / 2 - this.y 
          }
        };
      }
    }
    return null;
  }

  contains(x, y) {
    const points = this.vertices.map(v => ({
      x: this.x + v.x,
      y: this.y + v.y
    }));
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  draw() {
    this.updateColor();
    
    ctx.globalAlpha = parseInt(mosaicOpacityInput.value) / 100;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(this.x + this.vertices[0].x, this.y + this.vertices[0].y);
    for (let i = 1; i < this.vertices.length; i++) {
      ctx.lineTo(this.x + this.vertices[i].x, this.y + this.vertices[i].y);
    }
    ctx.closePath();
    ctx.fill();
    
    // Обводка
    if (this.isSelected) {
      ctx.strokeStyle = '#77aaff';
    } else {
      ctx.strokeStyle = strokeColorInput.value;
    }
    ctx.lineWidth = strokeWidthInput.value;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Вершины (только для выделенной фигуры)
    if (this.isSelected) {
      ctx.fillStyle = '#31d';
      this.vertices.forEach(v => {
        ctx.beginPath();
        ctx.arc(this.x + v.x, this.y + v.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
}

// Генерация фигур
function generateTriangleVertices(size = 40) {
  const height = size * Math.sqrt(3) / 2;
  return [
    { x: 0, y: -height/2 },
    { x: -size/2, y: height/2 },
    { x: size/2, y: height/2 }
  ];
}

function generateSquareVertices(size = 40) {
  const half = size / 2;
  return [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half }
  ];
}

function generateHexagonVertices(size = 40) {
  const vertices = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    vertices.push({
      x: Math.cos(angle) * size,
      y: Math.sin(angle) * size
    });
  }
  return vertices;
}

// Вспомогательные функции
function distanceToLine(x, y, x1, y1, x2, y2) {
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  }
  else if (param > 1) {
    xx = x2;
    yy = y2;
  }
  else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  return Math.sqrt((x - xx) ** 2 + (y - yy) ** 2);
}

function drawSymmetryAxis() {
  if (!isSymmetryMode) return;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.strokeStyle = 'red';
  ctx.stroke();
  ctx.setLineDash([]);
}

function createSymmetricPair(x, y, vertices) {
  const shape1 = new Shape(x, y, vertices);
  const mirroredVertices = vertices.map(v => ({ x: -v.x, y: v.y }));
  const shape2 = new Shape(canvas.width - x, y, mirroredVertices);
  
  shapes.push(shape1, shape2);
  symmetricPairs.set(shape1, shape2);
  symmetricPairs.set(shape2, shape1);
}

function findConnectedVertices(shape, vertexIndex) {
  const result = [{shape, vertexIndex}];
  const originalX = shape.x + shape.vertices[vertexIndex].x;
  const originalY = shape.y + shape.vertices[vertexIndex].y;
  
  shapes.forEach(otherShape => {
    if (otherShape === shape) return;
    
    otherShape.vertices.forEach((v, i) => {
      const vx = otherShape.x + v.x;
      const vy = otherShape.y + v.y;
      const distance = Math.sqrt(
        Math.pow(originalX - vx, 2) + 
        Math.pow(originalY - vy, 2)
      );
      
      if (distance < SNAP_DISTANCE * 1.5) {
        result.push({shape: otherShape, vertexIndex: i});
      }
    });
  });
  
  return result;
}

function snapVertices(shape) {
  const snapThreshold = SNAP_DISTANCE;
  
  shape.vertices.forEach((sv, i) => {
    const shapeVx = shape.x + sv.x;
    const shapeVy = shape.y + sv.y;
    
    shapes.forEach(other => {
      if (other === shape) return;
      
      other.vertices.forEach((ov, j) => {
        const otherVx = other.x + ov.x;
        const otherVy = other.y + ov.y;
        const distance = Math.sqrt(
          Math.pow(shapeVx - otherVx, 2) + 
          Math.pow(shapeVy - otherVy, 2)
        );
        
        if (distance < snapThreshold && shape.isDragging) {
          sv.x = otherVx - shape.x;
          sv.y = otherVy - shape.y;
          
          if (isSymmetryMode && symmetricPairs.has(shape)) {
            const mirror = symmetricPairs.get(shape);
            mirror.vertices[i].x = canvas.width - otherVx - mirror.x;
            mirror.vertices[i].y = otherVy - mirror.y;
          }
        }
      });
    });
  });
}

function splitShapeIntoTriangles(shape, pointX, pointY) {
  history.saveState();
  
  const newVertex = {
    x: pointX - shape.x,
    y: pointY - shape.y
  };
  
  const triangles = [];
  for (let i = 0; i < shape.vertices.length; i++) {
    const j = (i + 1) % shape.vertices.length;
    triangles.push({
      vertices: [
        { ...shape.vertices[i] },
        { ...shape.vertices[j] },
        { ...newVertex }
      ]
    });
  }
  
  const index = shapes.indexOf(shape);
  shapes.splice(index, 1);
  
  triangles.forEach(triangle => {
    const newShape = new Shape(shape.x, shape.y, triangle.vertices);
    newShape.color = shape.color;
    shapes.push(newShape);
  });
  
  render();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (backgroundImage) {
    ctx.globalAlpha = parseInt(imageOpacityInput.value) / 100;
    ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }
  
  drawSymmetryAxis();
  shapes.forEach(shape => shape.draw());
  
  if (selectionStart) {
    ctx.strokeStyle = '#0095ff';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(
      selectionStart.x,
      selectionStart.y,
      lastMousePosition.x - selectionStart.x,
      lastMousePosition.y - selectionStart.y
    );
    ctx.setLineDash([]);
  }
}

// Сохранение изображений
function saveAsSVG() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", canvas.width);
  svg.setAttribute("height", canvas.height);
  svg.setAttribute("viewBox", `0 0 ${canvas.width} ${canvas.height}`);
  
  // Добавляем изображение (если есть)
  if (backgroundImage) {
    const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
    img.setAttribute("href", backgroundImage.src);
    img.setAttribute("width", canvas.width);
    img.setAttribute("height", canvas.height);
    img.setAttribute("opacity", parseInt(imageOpacityInput.value) / 100);
    svg.appendChild(img);
  }
  
  // Добавляем фигуры
  shapes.forEach(shape => {
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    const points = shape.vertices.map(v => 
      `${shape.x + v.x},${shape.y + v.y}`
    ).join(" ");
    polygon.setAttribute("points", points);
    polygon.setAttribute("fill", shape.color);
    polygon.setAttribute("stroke", shape.isSelected ? '#ff0000' : strokeColorInput.value);
    polygon.setAttribute("stroke-width", strokeWidthInput.value);
    polygon.setAttribute("opacity", parseInt(mosaicOpacityInput.value) / 100);
    svg.appendChild(polygon);
  });
  
  const serializer = new XMLSerializer();
  let svgStr = serializer.serializeToString(svg);
  svgStr = '<?xml version="1.0" standalone="no"?>\n' + svgStr;
  
  const blob = new Blob([svgStr], {type: "image/svg+xml"});
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = "mosaic.svg";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function saveAsPNG() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tempCtx = tempCanvas.getContext('2d');
  
  // Рисуем фон
  tempCtx.fillStyle = '#f9f5e8';
  tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  
  // Рисуем изображение (если есть)
  if (backgroundImage) {
    tempCtx.globalAlpha = parseInt(imageOpacityInput.value) / 100;
    tempCtx.drawImage(backgroundImage, 0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.globalAlpha = 1;
  }
  
  // Рисуем фигуры
  shapes.forEach(shape => {
    tempCtx.globalAlpha = parseInt(mosaicOpacityInput.value) / 100;
    tempCtx.fillStyle = shape.color;
    tempCtx.beginPath();
    tempCtx.moveTo(shape.x + shape.vertices[0].x, shape.y + shape.vertices[0].y);
    for (let i = 1; i < shape.vertices.length; i++) {
      tempCtx.lineTo(shape.x + shape.vertices[i].x, shape.y + shape.vertices[i].y);
    }
    tempCtx.closePath();
    tempCtx.fill();
    
    // Обводка
    if (shape.isSelected) {
      tempCtx.strokeStyle = '#ff0000';
    } else {
      tempCtx.strokeStyle = strokeColorInput.value;
    }
    tempCtx.lineWidth = strokeWidthInput.value;
    tempCtx.stroke();
    tempCtx.globalAlpha = 1;
  });
  
  const dataURL = tempCanvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = dataURL;
  link.download = "mosaic.png";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Обработчики событий
imageUpload.addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(event) {
    const img = new Image();
    img.onload = function() {
      backgroundImage = img;
      canvas.width = img.width;
      canvas.height = img.height;
      render();
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

imageOpacityInput.addEventListener('input', render);
mosaicOpacityInput.addEventListener('input', render);

symmetryBtn.addEventListener('click', function() {
  isSymmetryMode = !isSymmetryMode;
  this.textContent = isSymmetryMode ? 'Выключить симметрию' : 'Включить симметрию';
  render();
});

shapeSizeInput.addEventListener('input', render);
strokeColorInput.addEventListener('input', render);
strokeWidthInput.addEventListener('input', render);

deleteSelectedBtn.addEventListener('click', () => {
  history.saveState();
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (shapes[i].isSelected) {
      if (isSymmetryMode && symmetricPairs.has(shapes[i])) {
        const mirror = symmetricPairs.get(shapes[i]);
        shapes.splice(shapes.indexOf(mirror), 1);
        symmetricPairs.delete(mirror);
      }
      shapes.splice(i, 1);
    }
  }
  render();
});

undoBtn.addEventListener('click', () => {
  history.undo();
  render();
});

redoBtn.addEventListener('click', () => {
  history.redo();
  render();
});

saveSVGBtn.addEventListener('click', saveAsSVG);
savePNGBtn.addEventListener('click', saveAsPNG);

// Контекстные меню
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  clickedShape = null;
  for (let shape of shapes) {
    if (shape.contains(mouseX, mouseY)) {
      clickedShape = shape;
      break;
    }
  }
  
  if (clickedShape) {
    shapeContextMenu.style.display = 'block';
    shapeContextMenu.style.left = `${e.clientX}px`;
    shapeContextMenu.style.top = `${e.clientY}px`;
    contextMenu.style.display = 'none';
  } else {
    contextMenu.style.display = 'block';
    contextMenu.style.left = `${e.clientX}px`;
    contextMenu.style.top = `${e.clientY}px`;
    shapeContextMenu.style.display = 'none';
  }
  
  menuPosition = { x: mouseX, y: mouseY };
});

window.addEventListener('click', (e) => {
  if (e.target !== splitIntoTrianglesBtn && 
      e.target !== addTriangleBtn && 
      e.target !== addSquareBtn && 
      e.target !== addHexagonBtn) {
    contextMenu.style.display = 'none';
    shapeContextMenu.style.display = 'none';
  }
});

splitIntoTrianglesBtn.addEventListener('click', () => {
  if (clickedShape) {
    splitShapeIntoTriangles(clickedShape, menuPosition.x, menuPosition.y);
  }
  shapeContextMenu.style.display = 'none';
});

// Добавление фигур
function addShape(verticesGenerator) {
  history.saveState();
  const size = parseInt(shapeSizeInput.value);
  if (isSymmetryMode) {
    createSymmetricPair(menuPosition.x, menuPosition.y, verticesGenerator(size));
  } else {
    shapes.push(new Shape(menuPosition.x, menuPosition.y, verticesGenerator(size)));
  }
  contextMenu.style.display = 'none';
  render();
}

addTriangleBtn.addEventListener('click', () => addShape(generateTriangleVertices));
addSquareBtn.addEventListener('click', () => addShape(generateSquareVertices));
addHexagonBtn.addEventListener('click', () => addShape(generateHexagonVertices));

// Взаимодействие с фигурами
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  lastMousePosition = { x: mouseX, y: mouseY };

    // Сбрасываем выделение при обычном клике на пустое место
  if (e.button === 0 && !e.ctrlKey && !e.altKey) {
    let clickedOnShape = false;
    for (let shape of shapes) {
      if (shape.contains(mouseX, mouseY) || shape.hitTestVertex(mouseX, mouseY) !== null) {
        clickedOnShape = true;
        break;
      }
    }
    
    if (!clickedOnShape) {
      shapes.forEach(shape => shape.isSelected = false);
      render();
      return;
    }
  }
  
  // // Сбрасываем выделение при клике (если не зажата Ctrl)
  // if (e.button === 0 && !e.ctrlKey) {
  //   let vertexClicked = false;
    
  //   // Проверяем, кликнули ли мы на вершину
  //   for (let shape of shapes) {
  //     const vertexIndex = shape.hitTestVertex(mouseX, mouseY);
  //     if (vertexIndex !== null) {
  //       vertexClicked = true;
  //       break;
  //     }
  //   }
    
  //   // Если клик не по вершине - сбрасываем выделение
  //   if (!vertexClicked) {
  //     shapes.forEach(shape => shape.isSelected = false);
  //   }
  // }

  // Alt + клик по вершине - удаление вершины
  if (e.altKey && e.button === 0) {
    history.saveState();
    for (let shape of shapes) {
      const vertexIndex = shape.hitTestVertex(mouseX, mouseY);
      if (vertexIndex !== null && shape.vertices.length > 3) {
        shape.vertices.splice(vertexIndex, 1);
        if (isSymmetryMode && symmetricPairs.has(shape)) {
          const mirror = symmetricPairs.get(shape);
          mirror.vertices.splice(vertexIndex, 1);
        }
        render();
        return;
      }
    }
  }
  
  // Двойной клик по ребру - добавление вершины
  if (e.detail === 2 && e.button === 0) {
    history.saveState();
    for (let shape of shapes) {
      const edge = shape.hitTestEdge(mouseX, mouseY);
      if (edge) {
        shape.vertices.splice(edge.edgeIndex + 1, 0, edge.position);
        if (isSymmetryMode && symmetricPairs.has(shape)) {
          const mirror = symmetricPairs.get(shape);
          const mirroredPosition = { x: -edge.position.x, y: edge.position.y };
          mirror.vertices.splice(edge.edgeIndex + 1, 0, mirroredPosition);
        }
        render();
        return;
      }
    }
  }

  if (e.button !== 0) return;

  // Начало прямоугольного выделения (Ctrl + левая кнопка)
  if (e.button === 0 && e.ctrlKey) {
    selectionStart = { x: mouseX, y: mouseY };
    return;
  }

  // Проверка на вершину (теперь работает везде вокруг вершины)
  let anyVertexClicked = false;
  
  for (let shape of shapes) {
    const vertexIndex = shape.hitTestVertex(mouseX, mouseY);
    if (vertexIndex !== null) {
      // Сбрасываем выделение со всех фигур, если не зажата Ctrl
      if (!e.ctrlKey) {
        shapes.forEach(s => s.isSelected = false);
      }
      
      dragMode = 'vertex';
      shape.isDragging = true;
      shape.dragVertex = vertexIndex;
      activeShape = shape;
      shape.isSelected = true;
      anyVertexClicked = true;
      
      // Находим все связанные вершины
      const connectedVertices = findConnectedVertices(shape, vertexIndex);
      
      // Запоминаем смещения для связанных вершин
      connectedVertices.forEach(({shape: connectedShape, vertexIndex: connectedIndex}) => {
        connectedShape.vertexOffsets = connectedShape.vertexOffsets || {};
        connectedShape.vertexOffsets[connectedIndex] = {
          x: mouseX - (connectedShape.x + connectedShape.vertices[connectedIndex].x),
          y: mouseY - (connectedShape.y + connectedShape.vertices[connectedIndex].y)
        };
      });
      
      break;
    }
  }
  
  if (anyVertexClicked) return;

  // Проверка на перемещение фигуры
  for (let shape of shapes) {
    if (shape.contains(mouseX, mouseY)) {
      dragMode = 'shape';
      shape.isDragging = true;
      activeShape = shape;
      
      if (!shape.isSelected && !e.ctrlKey) {
        shapes.forEach(s => s.isSelected = false);
      }
      shape.isSelected = true;
      
      shape.offsetX = mouseX - shape.x;
      shape.offsetY = mouseY - shape.y;
      render();
      return;
    }
  }
});

// canvas.addEventListener('mousemove', (e) => {
//   const rect = canvas.getBoundingClientRect();
//   const mouseX = e.clientX - rect.left;
//   const mouseY = e.clientY - rect.top;
//   lastMousePosition = { x: mouseX, y: mouseY };

//   if (selectionStart) {
//     render();
//     return;
//   }

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  lastMousePosition = { x: mouseX, y: mouseY };

  // Показываем пунктирное выделение только при нажатом Ctrl
  if (selectionStart && ctrlPressed) {
    render();
    return;
  }

  if (!activeShape || !dragMode) return;

  if (dragMode === 'vertex' && activeShape.dragVertex !== null) {
    // Перемещаем активную вершину
    activeShape.vertices[activeShape.dragVertex].x = mouseX - activeShape.x;
    activeShape.vertices[activeShape.dragVertex].y = mouseY - activeShape.y;
    
    // Перемещаем связанные вершины
    shapes.forEach(shape => {
      if (shape.vertexOffsets) {
        Object.keys(shape.vertexOffsets).forEach(index => {
          const offset = shape.vertexOffsets[index];
          shape.vertices[index].x = mouseX - offset.x - shape.x;
          shape.vertices[index].y = mouseY - offset.y - shape.y;
        });
      }
    });
    
    // Для симметричных фигур
    if (isSymmetryMode && symmetricPairs.has(activeShape)) {
      const mirror = symmetricPairs.get(activeShape);
      const axisX = canvas.width / 2;
      const mirroredX = 2 * axisX - mouseX;
      
      mirror.vertices[activeShape.dragVertex].x = mirroredX - mirror.x;
      mirror.vertices[activeShape.dragVertex].y = mouseY - mirror.y;
    }
    
    snapVertices(activeShape);
  } else if (dragMode === 'shape') {
    const dx = mouseX - activeShape.offsetX - activeShape.x;
    const dy = mouseY - activeShape.offsetY - activeShape.y;
    
    shapes.forEach(shape => {
      if (shape.isSelected) {
        shape.x += dx;
        shape.y += dy;
        
        if (isSymmetryMode && symmetricPairs.has(shape)) {
          const mirror = symmetricPairs.get(shape);
          mirror.x = canvas.width - shape.x;
          mirror.y = shape.y;
        }
      }
    });
  }
  
  render();
});

canvas.addEventListener('mouseup', (e) => {
  // Очищаем сохраненные смещения вершин
  shapes.forEach(shape => {
    if (shape.vertexOffsets) {
      delete shape.vertexOffsets;
    }
  });
  
  if (selectionStart) {
    // Применяем выделение только если Ctrl все еще нажата
    if (ctrlPressed) {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const x1 = Math.min(selectionStart.x, mouseX);
      const y1 = Math.min(selectionStart.y, mouseY);
      const x2 = Math.max(selectionStart.x, mouseX);
      const y2 = Math.max(selectionStart.y, mouseY);
      
      shapes.forEach(shape => {
        const isInSelection = (
          shape.x >= x1 && shape.x <= x2 &&
          shape.y >= y1 && shape.y <= y2
        );
        
        if (e.ctrlKey) {
          if (isInSelection) shape.isSelected = true;
        } else {
          shape.isSelected = isInSelection;
        }
      });
    }
    
    // Всегда сбрасываем выделение после отпускания мыши
    selectionStart = null;
    render();
  }
  
  if (activeShape) {
    if (dragMode === 'vertex' || dragMode === 'shape') {
      history.saveState();
    }
    
    activeShape.isDragging = false;
    activeShape.dragVertex = null;
    activeShape = null;
  }
  dragMode = null;
});

// Горячие клавиши
document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete') {
    deleteSelectedBtn.click();
  }
  
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    const step = e.shiftKey ? 10 : 1;
    let moved = false;
    
    shapes.forEach(shape => {
      if (shape.isSelected) {
        if (e.key === 'ArrowUp') shape.y -= step;
        if (e.key === 'ArrowDown') shape.y += step;
        if (e.key === 'ArrowLeft') shape.x -= step;
        if (e.key === 'ArrowRight') shape.x += step;
        moved = true;
        
        if (isSymmetryMode && symmetricPairs.has(shape)) {
          const mirror = symmetricPairs.get(shape);
          mirror.x = canvas.width - shape.x;
          mirror.y = shape.y;
        }
      }
    });
    
    if (moved) {
      history.saveState();
      render();
    }
  }
  
  if (e.ctrlKey) {
    if (e.key === 'z') {
      e.preventDefault();
      history.undo();
      render();
    } else if (e.key === 'y') {
      e.preventDefault();
      history.redo();
      render();
    } else if (e.key === 's') {
      e.preventDefault();
      saveAsSVG();
    }
  }
});

// Инициализация
history.saveState();
render();
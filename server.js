const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createCanvas, loadImage } = require('canvas');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Store canvases in memory (in a production environment, use a proper database)
const canvases = new Map();
let nextElementId = 1;
// Add history tracking
const canvasHistory = new Map();

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

// Initialize canvas
app.post('/api/canvas/initialize', (req, res) => {
  const { width, height, id } = req.body;
  const canvas = {
    width,
    height,
    elements: []
  };
  canvases.set(id, canvas);
  // Initialize empty history for this canvas
  canvasHistory.set(id, []);
  res.json({ id });
});

// Helper function to save canvas state
const saveCanvasState = (canvasId) => {
  const canvas = canvases.get(canvasId);
  if (canvas) {
    const history = canvasHistory.get(canvasId) || [];
    // Deep clone the elements array to store in history
    history.push(JSON.parse(JSON.stringify(canvas.elements)));
    // Keep only last 20 states to manage memory
    if (history.length > 20) {
      history.shift();
    }
    canvasHistory.set(canvasId, history);
  }
};

// Add undo endpoint
app.post('/api/canvas/undo', (req, res) => {
  const { id } = req.body;
  const canvas = canvases.get(id);
  const history = canvasHistory.get(id);

  if (!canvas || !history || history.length === 0) {
    return res.status(404).json({ error: 'No history available' });
  }

  // Get the previous state
  const previousState = history.pop();
  if (previousState) {
    canvas.elements = previousState;
    canvases.set(id, canvas);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'No more history available' });
  }
});

app.post('/api/canvas/element-at', (req, res) => {
  const { id } = req.body;
  const { x, y } = req.body;
  const canvas = canvases.get(id);
  
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found' });
  }

  // Find element at coordinates
  const elements = canvas.elements || [];
  const element = canvas.elements.find(el => {
    if (el.type === 'rectangle') {
      return x >= el.x && x <= el.x + el.width &&
             y >= el.y && y <= el.y + el.height;
    } else if (el.type === 'circle') {
      const centerX = el.x + el.radius;
      const centerY = el.y + el.radius;
      const distance = Math.sqrt(
        Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
      );
      return distance <= el.radius;
    } else if (el.type === 'text') {
      // Approximate text bounds
      const width = el.text.length * (el.fontSize / 2);
      const height = el.fontSize;
      return x >= el.x && x <= el.x + width &&
             y >= el.y && y <= el.y + height;
    }
    return false;
  });

  res.json({ element: element || null });
});

// Update element endpoint
app.post('/api/canvas/update-element', (req, res) => {
  const { id, elementId, x, y, type, color, isFilled, radius, width, height } = req.body;
  const canvas = canvases.get(id);
  
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found' });
  }

  const element = canvas.elements.find(el => el.id === elementId);
  if (element) {
    // Save state before updating
    saveCanvasState(id);

    // Update all properties
    element.x = x;
    element.y = y;
    element.color = color;
    element.isFilled = isFilled;

    // Update type-specific properties
    if (type === 'circle' && radius !== undefined) {
      element.radius = radius;
    }
    if (type === 'rectangle') {
      if (width !== undefined) element.width = width;
      if (height !== undefined) element.height = height;
    }

    res.json({ success: true, element });
  } else {
    res.status(404).json({ error: 'Element not found' });
  }
});

// Modify existing endpoints to save history before changes
app.post('/api/canvas/rectangle', (req, res) => {
  const { id, x, y, width, height, color } = req.body;
  const canvas = canvases.get(id);
  
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found' });
  }

  saveCanvasState(id); // Save state before change
  canvas.elements.push({
    id: nextElementId++,
    type: 'rectangle',
    x,
    y,
    width,
    height,
    color
  });

  res.json({ success: true });
});

app.post('/api/canvas/circle', (req, res) => {
  const { id, x, y, radius, color } = req.body;
  const canvas = canvases.get(id);
  
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found' });
  }

  saveCanvasState(id); // Save state before change
  canvas.elements.push({
    id: nextElementId++,
    type: 'circle',
    x,
    y,
    radius: radius || 50,
    color
  });

  res.json({ success: true });
});

app.post('/api/canvas/text', (req, res) => {
  const { id, x, y, text, fontSize, color } = req.body;
  const canvas = canvases.get(id);
  
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found' });
  }

  saveCanvasState(id); // Save state before change
  canvas.elements.push({
    id: nextElementId++,
    type: 'text',
    x,
    y,
    text,
    fontSize,
    color
  });
  
  res.json({ success: true });
});

app.post('/api/canvas/image', upload.single('image'), async (req, res) => {
  const { id, x, y, width, height } = req.body;
  const canvas = canvases.get(id);
  
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found' });
  }

  saveCanvasState(id); // Save state before change
  canvas.elements.push({
    id: nextElementId++,
    type: 'image',
    x: parseFloat(x),
    y: parseFloat(y),
    width: parseFloat(width),
    height: parseFloat(height),
    path: req.file.path
  });
  
  res.json({ success: true });
});

// Add line endpoint
app.post('/api/canvas/line', (req, res) => {
  const { id, startX, startY, endX, endY, color } = req.body;
  const canvas = canvases.get(id);
  
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found' });
  }

  saveCanvasState(id); // Save state before change
  canvas.elements.push({
    id: nextElementId++,
    type: 'line',
    startX,
    startY,
    endX,
    endY,
    color
  });
  
  res.json({ success: true });
});

// Add unified element endpoint
app.post('/api/canvas/add-element', (req, res) => {
  const { id, element } = req.body;
  const canvas = canvases.get(id);
  
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found' });
  }

  saveCanvasState(id); // Save state before change
  
  // Add unique ID to the element
  const elementWithId = {
    ...element,
    id: nextElementId++
  };
  
  canvas.elements.push(elementWithId);
  res.json({ success: true, element: elementWithId });
});

// Export as PDF
app.post('/api/canvas/export-pdf', async (req, res) => {
  const { id } = req.body;
  const canvas = canvases.get(id);
  
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found' });
  }
  
  const doc = new PDFDocument({
    size: [canvas.width, canvas.height]
  });
  
  const filename = `canvas-${id}-${Date.now()}.pdf`;
  const writeStream = fs.createWriteStream(`uploads/${filename}`);
  doc.pipe(writeStream);
  
  const canvasInstance = createCanvas(canvas.width, canvas.height);
  const ctx = canvasInstance.getContext('2d');

  // Set white background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw elements
  for (const element of canvas.elements) {
    ctx.lineWidth = 2;
    
    switch (element.type) {
      case 'line':
        ctx.beginPath();
        ctx.strokeStyle = element.color;
        ctx.moveTo(element.startX, element.startY);
        ctx.lineTo(element.endX, element.endY);
        ctx.stroke();
        break;
      case 'rectangle':
        if (element.isFilled) {
          ctx.fillStyle = element.color;
          ctx.fillRect(element.x, element.y, element.width, element.height);
        } else {
          ctx.strokeStyle = element.color;
          ctx.strokeRect(element.x, element.y, element.width, element.height);
        }
        break;
      case 'circle':
        ctx.beginPath();
        if (element.isFilled) {
          ctx.fillStyle = element.color;
          ctx.arc(
            element.x + element.radius,
            element.y + element.radius,
            element.radius,
            0,
            2 * Math.PI
          );
          ctx.fill();
        } else {
          ctx.strokeStyle = element.color;
          ctx.arc(
            element.x + element.radius,
            element.y + element.radius,
            element.radius,
            0,
            2 * Math.PI
          );
          ctx.stroke();
        }
        break;
      case 'text':
        ctx.font = `${element.fontSize}px Arial`;
        ctx.fillStyle = element.color;
        ctx.fillText(element.text, element.x, element.y + element.fontSize);
        break;
      case 'image':
        try {
          const image = await loadImage(element.path);
          ctx.drawImage(image, element.x, element.y, element.width, element.height);
        } catch (error) {
          console.error('Error loading image:', error);
        }
        break;
    }
  }

  doc.image(canvasInstance.toBuffer(), 0, 0, {
    width: canvas.width,
    height: canvas.height
  });
  
  doc.end();
  
  writeStream.on('finish', () => {
    res.json({
      message: 'PDF created',
      url: `/uploads/${filename}`
    });
  });
});

// Get canvas preview
app.get('/api/canvas/:id/preview', async (req, res) => {
  const { id } = req.params;
  const canvas = canvases.get(id);
  
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found' });
  }

  const canvasInstance = createCanvas(canvas.width, canvas.height);
  const ctx = canvasInstance.getContext('2d');

  // Set white background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw elements
  for (const element of canvas.elements) {
    ctx.lineWidth = 2;
    
    switch (element.type) {
      case 'line':
        ctx.beginPath();
        ctx.strokeStyle = element.color;
        ctx.moveTo(element.startX, element.startY);
        ctx.lineTo(element.endX, element.endY);
        ctx.stroke();
        break;
      case 'rectangle':
        if (element.isFilled) {
          ctx.fillStyle = element.color;
          ctx.fillRect(element.x, element.y, element.width, element.height);
        } else {
          ctx.strokeStyle = element.color;
          ctx.strokeRect(element.x, element.y, element.width, element.height);
        }
        break;
      case 'circle':
        ctx.beginPath();
        if (element.isFilled) {
          ctx.fillStyle = element.color;
          ctx.arc(
            element.x + element.radius,
            element.y + element.radius,
            element.radius,
            0,
            2 * Math.PI
          );
          ctx.fill();
        } else {
          ctx.strokeStyle = element.color;
          ctx.arc(
            element.x + element.radius,
            element.y + element.radius,
            element.radius,
            0,
            2 * Math.PI
          );
          ctx.stroke();
        }
        break;
      case 'text':
        ctx.font = `${element.fontSize}px Arial`;
        ctx.fillStyle = element.color;
        ctx.fillText(element.text, element.x, element.y + element.fontSize);
        break;
      case 'image':
        try {
          const image = await loadImage(element.path);
          ctx.drawImage(image, element.x, element.y, element.width, element.height);
        } catch (error) {
          console.error('Error loading image:', error);
        }
        break;
    }
  }

  const buffer = canvasInstance.toBuffer('image/png');
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': buffer.length
  });
  res.end(buffer);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 
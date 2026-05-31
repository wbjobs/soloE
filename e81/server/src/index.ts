import express = require('express');
import cors = require('cors');
import multer = require('multer');
import { encodePng, decodePng } from './wasm';

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'image/png') {
      cb(new Error('Only PNG images are supported'));
      return;
    }
    cb(null, true);
  },
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Steganography API is running' });
});

app.post('/api/encode', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No image file provided. Please select a PNG image.' 
      });
    }
    
    const text = req.body.text as string;
    if (!text || text.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'No text provided. Please enter text to hide.' 
      });
    }
    
    if (text.length > 100000) {
      return res.status(400).json({
        success: false,
        message: 'Text too long. Maximum 100,000 characters allowed.'
      });
    }

    const password = req.body.password as string | undefined;
    const useEncryption = req.body.useEncryption === 'true' || req.body.useEncryption === true;
    const actualPassword = useEncryption && password ? password : undefined;
    
    if (useEncryption && (!password || password.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Password is required when encryption is enabled.'
      });
    }

    console.log(`[Encode] Processing file: ${req.file.originalname}, size: ${req.file.size} bytes, text length: ${text.length}, encrypted: ${!!actualPassword}`);
    
    const encodedBuffer = await encodePng(req.file.buffer, text, actualPassword);
    
    console.log(`[Encode] Success. Original: ${req.file.size} bytes, Encoded: ${encodedBuffer.length} bytes`);
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="encoded.png"');
    res.setHeader('X-Original-Size', req.file.size.toString());
    res.setHeader('X-Encoded-Size', encodedBuffer.length.toString());
    res.setHeader('X-Encrypted', actualPassword ? 'true' : 'false');
    res.send(encodedBuffer);
  } catch (error: any) {
    console.error('[Encode] Error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to encode image. Please try again with a smaller image.' 
    });
  }
});

app.post('/api/decode', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No image file provided. Please select a PNG image.' 
      });
    }

    const password = req.body.password as string | undefined;
    
    console.log(`[Decode] Processing file: ${req.file.originalname}, size: ${req.file.size} bytes, has password: ${!!password}`);
    
    const text = await decodePng(req.file.buffer, password);
    
    console.log(`[Decode] Success. Extracted ${text.length} characters`);
    
    res.json({ 
      success: true, 
      message: `Successfully extracted ${text.length} characters`,
      text 
    });
  } catch (error: any) {
    console.error('[Decode] Error:', error.message);
    res.json({ 
      success: false, 
      message: error.message || 'No hidden data found or invalid image',
      text: ''
    });
  }
});

app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `File too large. Maximum ${MAX_FILE_SIZE / 1024 / 1024}MB allowed.`
      });
    }
  }
  if (error.message === 'Only PNG images are supported') {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  next(error);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Maximum file size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
});

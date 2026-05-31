/**
 * local server entry file, for local development
 */
import app from './app.js';
import { PointCloudWebSocketServer } from './services/WebSocketServer.js';

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

/**
 * WebSocket Server for collaborative editing
 */
const wsServer = new PointCloudWebSocketServer(server);
console.log('WebSocket server started on path /ws');

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  wsServer.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  wsServer.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
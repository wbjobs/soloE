const WebSocket = require('ws');

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

let document = '';
let version = 0;
let history = [];
let clients = new Map();

function getOnlineUsers() {
  const users = [];
  clients.forEach((clientData, ws) => {
    if (clientData.username) {
      users.push(clientData.username);
    }
  });
  return users;
}

function broadcastUserList() {
  const userList = getOnlineUsers();
  clients.forEach((clientData, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'userList',
        users: userList
      }));
    }
  });
}

function transform(op1, op2) {
  if (op1.type !== 'insert' || op2.type !== 'insert') {
    return op1;
  }
  
  if (op1.position <= op2.position) {
    return op1;
  }
  
  return {
    ...op1,
    position: op1.position + op2.content.length
  };
}

function applyOperation(doc, op) {
  if (op.type === 'insert') {
    return doc.slice(0, op.position) + op.content + doc.slice(op.position);
  } else if (op.type === 'delete') {
    return doc.slice(0, op.position) + doc.slice(op.position + op.length);
  }
  return doc;
}

console.log(`WebSocket server running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  console.log('New client connected, waiting for auth...');
  clients.set(ws, { authenticated: false, username: null });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const clientData = clients.get(ws);
      
      if (data.type === 'auth') {
        const username = data.username.trim();
        if (username) {
          clientData.authenticated = true;
          clientData.username = username;
          console.log(`User authenticated: ${username}`);
          
          ws.send(JSON.stringify({ 
            type: 'init', 
            content: document,
            version: version,
            username: username
          }));
          
          broadcastUserList();
        }
        return;
      }
      
      if (!clientData.authenticated) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Please authenticate first'
        }));
        return;
      }
      
      if (data.type === 'operation') {
        let op = data.operation;
        const clientVersion = data.baseVersion;
        
        for (let i = clientVersion; i < version; i++) {
          op = transform(op, history[i]);
        }
        
        document = applyOperation(document, op);
        history.push(op);
        version++;
        
        clients.forEach((otherClientData, clientWs) => {
          if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ 
              type: 'operation', 
              operation: op,
              version: version,
              username: clientData.username
            }));
          }
        });
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    const clientData = clients.get(ws);
    if (clientData && clientData.username) {
      console.log(`User disconnected: ${clientData.username}`);
    } else {
      console.log('Client disconnected');
    }
    clients.delete(ws);
    broadcastUserList();
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
    broadcastUserList();
  });
});

console.log('Server ready for connections');

import { useState, useCallback, useRef, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { ConnectionStatus, FileInfo, FileMessage } from '../types';
import {
  generateRSAKeyPair,
  exportPublicKey,
  importPublicKey,
  encryptFile,
  encryptAESKey,
  decryptAESKey,
  decryptData,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  splitIntoChunks,
  concatenateChunks,
} from '../utils/crypto';

const CHUNK_SIZE = 16384;
const CONNECTION_TIMEOUT = 15000;

interface EncryptedFileMeta {
  chunks: ArrayBuffer[];
  fileName: string;
  fileSize: number;
  fileType: string;
  totalChunks: number;
  receivedChunks: number;
  encryptedKey?: string;
  iv?: string;
  authTag?: string;
}

export function useWebRTC() {
  const [socketStatus, setSocketStatus] = useState<ConnectionStatus>('disconnected');
  const [peerStatus, setPeerStatus] = useState<ConnectionStatus>('disconnected');
  const [roomId, setRoomId] = useState<string>('');
  const [isInRoom, setIsInRoom] = useState(false);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [error, setError] = useState<string>('');
  const [useRelay, setUseRelay] = useState(false);
  const [connectionMode, setConnectionMode] = useState<'p2p' | 'relay' | 'connecting'>('connecting');

  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const connectionTimeoutRef = useRef<number | null>(null);
  const iceServersRef = useRef<string[]>([]);
  const roomIdRef = useRef<string>('');
  
  const privateKeyRef = useRef<CryptoKey | null>(null);
  const peerPublicKeyRef = useRef<CryptoKey | null>(null);
  const myPublicKeyRef = useRef<string | null>(null);

  const receivingFilesRef = useRef<Map<string, EncryptedFileMeta>>(new Map());

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  const clearConnectionTimeout = useCallback(() => {
    if (connectionTimeoutRef.current !== null) {
      window.clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  }, []);

  const reportConnectionState = useCallback((state: RTCPeerConnectionState) => {
    if (socketRef.current && roomIdRef.current) {
      socketRef.current.emit('peer-connection-state', { 
        roomId: roomIdRef.current, 
        state 
      });
    }
  }, []);

  const decryptAndSaveFile = useCallback(async (fileData: EncryptedFileMeta, transferId: string) => {
    if (!fileData.encryptedKey || !fileData.iv || !fileData.authTag || !privateKeyRef.current) {
      console.error('Missing encryption data for decryption');
      return;
    }

    try {
      const encryptedKey = base64ToArrayBuffer(fileData.encryptedKey);
      const aesKey = await decryptAESKey(encryptedKey, privateKeyRef.current);
      const iv = base64ToArrayBuffer(fileData.iv);
      const authTag = base64ToArrayBuffer(fileData.authTag);
      
      const encryptedData = concatenateChunks(fileData.chunks.filter(Boolean));
      const decryptedData = await decryptData(encryptedData, aesKey, new Uint8Array(iv), new Uint8Array(authTag));
      
      const blob = new Blob([decryptedData], { type: fileData.fileType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileData.fileName;
      a.click();
      URL.revokeObjectURL(url);

      setFiles(prev => prev.map(f => 
        f.id === transferId ? { ...f, status: 'completed', progress: 100 } : f
      ));

      receivingFilesRef.current.delete(transferId);
    } catch (e) {
      console.error('Failed to decrypt file:', e);
      setError('文件解密失败');
    }
  }, []);

  const handleFileMessage = useCallback((message: FileMessage, rawData: ArrayBuffer) => {
    if (message.type === 'file-info' && message.transferId) {
      receivingFilesRef.current.set(message.transferId, {
        chunks: [],
        fileName: message.fileName || 'unknown',
        fileSize: message.fileSize || 0,
        fileType: message.fileType || 'application/octet-stream',
        totalChunks: message.totalChunks || 0,
        receivedChunks: 0,
        encryptedKey: message.encryptedKey,
        iv: message.iv,
        authTag: message.authTag,
      });

      setFiles(prev => [...prev, {
        id: message.transferId!,
        name: message.fileName || 'unknown',
        size: message.fileSize || 0,
        type: message.fileType || 'application/octet-stream',
        progress: 0,
        status: 'transferring',
        direction: 'receive',
      }]);
    } else if (message.type === 'file-chunk' && message.transferId) {
      const fileData = receivingFilesRef.current.get(message.transferId);
      if (fileData && message.chunkIndex !== undefined) {
        const jsonLength = new TextEncoder().encode(JSON.stringify({
          type: 'file-chunk',
          transferId: message.transferId,
          chunkIndex: message.chunkIndex,
          data: '',
        })).length;
        
        const chunkData = rawData.slice(jsonLength);
        fileData.chunks[message.chunkIndex] = chunkData;
        fileData.receivedChunks++;

        const progress = Math.round((fileData.receivedChunks / fileData.totalChunks) * 100);
        setFiles(prev => prev.map(f => 
          f.id === message.transferId ? { ...f, progress } : f
        ));
      }
    } else if (message.type === 'file-complete' && message.transferId) {
      const fileData = receivingFilesRef.current.get(message.transferId);
      if (fileData) {
        decryptAndSaveFile(fileData, message.transferId);
      }
    }
  }, [decryptAndSaveFile]);

  const setupDataChannel = useCallback((dataChannel: RTCDataChannel) => {
    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = () => {
      setPeerStatus('connected');
      setConnectionMode('p2p');
      setUseRelay(false);
      clearConnectionTimeout();
    };

    dataChannel.onclose = () => {
      if (!useRelay) {
        setPeerStatus('disconnected');
      }
    };

    dataChannel.onerror = (error) => {
      console.error('DataChannel error:', error);
    };

    dataChannel.onmessage = async (event) => {
      try {
        const data = event.data;
        
        if (data instanceof ArrayBuffer) {
          const decoder = new TextDecoder();
          const jsonStr = decoder.decode(data.slice(0, Math.min(data.byteLength, 1000)));
          
          if (jsonStr.startsWith('{')) {
            const message: FileMessage = JSON.parse(jsonStr);
            handleFileMessage(message, data);
          }
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    dataChannelRef.current = dataChannel;
  }, [clearConnectionTimeout, handleFileMessage, useRelay]);

  const createPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) return;

    const iceServersConfig = iceServersRef.current.length > 0 
      ? iceServersRef.current.map(url => ({ urls: url }))
      : [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ];

    const pc = new RTCPeerConnection({
      iceServers: iceServersConfig,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle'
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          roomId: roomIdRef.current,
          candidate: event.candidate
        });
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', pc.iceGatheringState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        reportConnectionState('failed');
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('Peer connection state:', state);
      reportConnectionState(state);

      if (state === 'connected') {
        setPeerStatus('connected');
        setConnectionMode('p2p');
        setUseRelay(false);
        clearConnectionTimeout();
        console.log('P2P connection established successfully!');
      } else if (state === 'disconnected' || state === 'failed') {
        setPeerStatus('disconnected');
      }
    };

    pc.ondatachannel = (event) => {
      const dataChannel = event.channel;
      setupDataChannel(dataChannel);
    };

    connectionTimeoutRef.current = window.setTimeout(() => {
      if (peerConnectionRef.current?.connectionState !== 'connected') {
        console.log('P2P connection timeout, requesting relay mode');
        reportConnectionState('failed');
      }
    }, CONNECTION_TIMEOUT);

    peerConnectionRef.current = pc;
  }, [reportConnectionState, clearConnectionTimeout, setupDataChannel]);

  const handleOffer = useCallback(async (offer: RTCSessionDescriptionInit) => {
    createPeerConnection();
    const pc = peerConnectionRef.current;
    if (!pc || !socketRef.current) return;

    setPeerStatus('connecting');
    setConnectionMode('connecting');
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socketRef.current.emit('answer', { roomId: roomIdRef.current, answer });
  }, [createPeerConnection]);

  const handleAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    const pc = peerConnectionRef.current;
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }, []);

  const handleIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    const pc = peerConnectionRef.current;
    if (!pc) return;

    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }, []);

  const createOffer = useCallback(async () => {
    createPeerConnection();
    const pc = peerConnectionRef.current;
    if (!pc || !socketRef.current) return;

    setPeerStatus('connecting');
    setConnectionMode('connecting');

    const dataChannel = pc.createDataChannel('file-transfer');
    setupDataChannel(dataChannel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socketRef.current.emit('offer', { roomId: roomIdRef.current, offer });
  }, [createPeerConnection, setupDataChannel]);

  const initRSAKeys = useCallback(async () => {
    if (privateKeyRef.current && myPublicKeyRef.current) return;

    const keyPair = await generateRSAKeyPair();
    privateKeyRef.current = keyPair.privateKey;
    myPublicKeyRef.current = await exportPublicKey(keyPair.publicKey);
  }, []);

  const sendFileViaRelay = useCallback(async (file: File) => {
    if (!socketRef.current) return;
    if (!peerPublicKeyRef.current) {
      setError('等待对等端公钥交换完成');
      return;
    }

    const transferId = Math.random().toString(36).substring(2, 10);

    const fileInfo: FileInfo = {
      id: transferId,
      name: file.name,
      size: file.size,
      type: file.type,
      progress: 0,
      status: 'transferring',
      direction: 'send',
    };
    setFiles(prev => [...prev, fileInfo]);

    const { encryptedData, aesKey, iv, authTag } = await encryptFile(file);
    const encryptedAESKey = await encryptAESKey(aesKey, peerPublicKeyRef.current);
    const encryptedChunks = splitIntoChunks(encryptedData, CHUNK_SIZE);
    const totalChunks = encryptedChunks.length;

    socketRef.current.emit('relay-file-info', {
      roomId: roomIdRef.current,
      fileInfo: {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        totalChunks,
        transferId,
        encryptedKey: arrayBufferToBase64(encryptedAESKey),
        iv: arrayBufferToBase64(iv),
        authTag: arrayBufferToBase64(authTag),
      }
    });

    let chunkIndex = 0;

    const sendNextChunk = () => {
      if (chunkIndex >= totalChunks) {
        setFiles(prev => prev.map(f => 
          f.id === transferId ? { ...f, status: 'completed', progress: 100 } : f
        ));
        return;
      }

      const chunkData = encryptedChunks[chunkIndex];
      
      socketRef.current?.emit('relay-file-chunk', {
        roomId: roomIdRef.current,
        fileId: transferId,
        chunkIndex,
        data: chunkData
      });

      chunkIndex++;
      const progress = Math.round((chunkIndex / totalChunks) * 100);
      setFiles(prev => prev.map(f => 
        f.id === transferId ? { ...f, progress } : f
      ));

      setTimeout(sendNextChunk, 10);
    };

    sendNextChunk();
  }, []);

  const sendFile = useCallback(async (file: File) => {
    const dataChannel = dataChannelRef.current;
    const canUseP2P = dataChannel && dataChannel.readyState === 'open' && !useRelay;
    const canUseRelay = useRelay && socketRef.current;

    if (!canUseP2P && !canUseRelay) {
      setError('未连接到对等端');
      return;
    }

    if (!peerPublicKeyRef.current) {
      setError('等待对等端公钥交换完成');
      return;
    }

    if (canUseP2P) {
      const transferId = Math.random().toString(36).substring(2, 10);

      const fileInfo: FileInfo = {
        id: transferId,
        name: file.name,
        size: file.size,
        type: file.type,
        progress: 0,
        status: 'transferring',
        direction: 'send',
      };
      setFiles(prev => [...prev, fileInfo]);

      const { encryptedData, aesKey, iv, authTag } = await encryptFile(file);
      const encryptedAESKey = await encryptAESKey(aesKey, peerPublicKeyRef.current);
      const encryptedChunks = splitIntoChunks(encryptedData, CHUNK_SIZE);
      const totalChunks = encryptedChunks.length;

      const infoMessage: FileMessage = {
        type: 'file-info',
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        totalChunks,
        transferId,
        encryptedKey: arrayBufferToBase64(encryptedAESKey),
        iv: arrayBufferToBase64(iv),
        authTag: arrayBufferToBase64(authTag),
      };
      dataChannel.send(JSON.stringify(infoMessage));

      let chunkIndex = 0;

      const sendNextChunk = () => {
        if (chunkIndex >= totalChunks) {
          const completeMessage: FileMessage = {
            type: 'file-complete',
            transferId,
          };
          dataChannel.send(JSON.stringify(completeMessage));
          
          setFiles(prev => prev.map(f => 
            f.id === transferId ? { ...f, status: 'completed', progress: 100 } : f
          ));
          return;
        }

        const chunkData = encryptedChunks[chunkIndex];
        
        const chunkHeader = JSON.stringify({
          type: 'file-chunk',
          transferId,
          chunkIndex,
        });

        const headerBytes = new TextEncoder().encode(chunkHeader);
        const combined = new Uint8Array(headerBytes.length + chunkData.byteLength);
        combined.set(headerBytes, 0);
        combined.set(new Uint8Array(chunkData), headerBytes.length);

        dataChannel.send(combined.buffer);

        chunkIndex++;
        const progress = Math.round((chunkIndex / totalChunks) * 100);
        setFiles(prev => prev.map(f => 
          f.id === transferId ? { ...f, progress } : f
        ));

        setTimeout(sendNextChunk, 10);
      };

      sendNextChunk();
    } else if (canUseRelay) {
      await sendFileViaRelay(file);
    }
  }, [useRelay, sendFileViaRelay]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.on('connect', () => {
      setSocketStatus('connected');
      setError('');
    });

    socket.on('disconnect', () => {
      setSocketStatus('disconnected');
      setPeerStatus('disconnected');
      clearConnectionTimeout();
    });

    socket.on('room-created', async ({ roomId: newRoomId, iceServers }: { roomId: string; iceServers: string[] }) => {
      setRoomId(newRoomId);
      setIsInRoom(true);
      iceServersRef.current = iceServers;
      setError('');
      await initRSAKeys();
    });

    socket.on('room-joined', async ({ roomId: newRoomId, iceServers }: { roomId: string; iceServers: string[] }) => {
      setRoomId(newRoomId);
      setIsInRoom(true);
      iceServersRef.current = iceServers;
      setError('等待公钥交换...');
      await initRSAKeys();
      if (myPublicKeyRef.current) {
        socket.emit('send-public-key', {
          roomId: newRoomId,
          publicKey: myPublicKeyRef.current
        });
      }
      createOffer();
    });

    socket.on('room-not-found', () => {
      setError('房间不存在');
    });

    socket.on('room-full', () => {
      setError('房间已满');
    });

    socket.on('user-joined', () => {
      if (myPublicKeyRef.current) {
        socket.emit('send-public-key', {
          roomId: roomIdRef.current,
          publicKey: myPublicKeyRef.current
        });
      }
      createOffer();
    });

    socket.on('offer', async (offer: RTCSessionDescriptionInit) => {
      await handleOffer(offer);
    });

    socket.on('answer', async (answer: RTCSessionDescriptionInit) => {
      await handleAnswer(answer);
    });

    socket.on('ice-candidate', async (candidate: RTCIceCandidateInit) => {
      await handleIceCandidate(candidate);
    });

    socket.on('enable-relay-mode', () => {
      console.log('Enabling relay mode - P2P connection failed');
      setUseRelay(true);
      setConnectionMode('relay');
      setPeerStatus('connected');
      clearConnectionTimeout();
      setError('P2P直连失败，已自动切换到服务器中继模式');
    });

    socket.on('relay-file-info', (fileInfo: FileMessage & { fileId: string; encryptedKey: string; iv: string; authTag: string }) => {
      if (fileInfo.fileId) {
        receivingFilesRef.current.set(fileInfo.fileId, {
          chunks: [],
          fileName: fileInfo.fileName || 'unknown',
          fileSize: fileInfo.fileSize || 0,
          fileType: fileInfo.fileType || 'application/octet-stream',
          totalChunks: fileInfo.totalChunks || 0,
          receivedChunks: 0,
          encryptedKey: fileInfo.encryptedKey,
          iv: fileInfo.iv,
          authTag: fileInfo.authTag,
        });

        setFiles(prev => [...prev, {
          id: fileInfo.fileId!,
          name: fileInfo.fileName || 'unknown',
          size: fileInfo.fileSize || 0,
          type: fileInfo.fileType || 'application/octet-stream',
          progress: 0,
          status: 'transferring',
          direction: 'receive',
        }]);
      }
    });

    socket.on('relay-file-progress', ({ fileId, progress }: { fileId: string; progress: number }) => {
      setFiles(prev => prev.map(f => 
        f.id === fileId ? { ...f, progress } : f
      ));
    });

    socket.on('relay-file-chunk', ({ fileId, chunkIndex, data }: { fileId: string; chunkIndex: number; data: ArrayBuffer }) => {
      const fileData = receivingFilesRef.current.get(fileId);
      if (fileData) {
        fileData.chunks[chunkIndex] = data;
        fileData.receivedChunks++;

        const progress = Math.round((fileData.receivedChunks / fileData.totalChunks) * 100);
        setFiles(prev => prev.map(f => 
          f.id === fileId ? { ...f, progress } : f
        ));
      }
    });

    socket.on('relay-file-complete', ({ fileId }: { fileId: string }) => {
      const fileData = receivingFilesRef.current.get(fileId);
      if (fileData) {
        decryptAndSaveFile(fileData, fileId);
        socket.emit('relay-file-complete', { roomId: roomIdRef.current, fileId });
      }
    });

    socket.on('public-key-exchange', async ({ publicKey, isInitiator }: { publicKey: string; isInitiator: boolean }) => {
      peerPublicKeyRef.current = await importPublicKey(publicKey);
      console.log('Received peer public key');
      
      if (!isInitiator && myPublicKeyRef.current) {
        socket.emit('send-public-key', {
          roomId: roomIdRef.current,
          publicKey: myPublicKeyRef.current
        });
      }
    });

    socket.on('peer-public-key', async ({ publicKey }: { publicKey: string }) => {
      peerPublicKeyRef.current = await importPublicKey(publicKey);
      console.log('Peer public key received, ready for secure file transfer');
      setError('');
    });

    return () => {
      socket.removeAllListeners();
    };
  }, [clearConnectionTimeout, createOffer, handleOffer, handleAnswer, handleIceCandidate]);

  const initSocket = useCallback(() => {
    if (socketRef.current) return;

    setSocketStatus('connecting');
    const socket = io('http://localhost:3001', {
      transports: ['websocket']
    });

    socketRef.current = socket;
  }, []);

  const createRoom = useCallback(() => {
    setUseRelay(false);
    setConnectionMode('connecting');
    if (!socketRef.current) {
      initSocket();
      setTimeout(() => {
        socketRef.current?.emit('create-room');
      }, 500);
    } else {
      socketRef.current.emit('create-room');
    }
  }, [initSocket]);

  const joinRoom = useCallback((roomIdToJoin: string) => {
    if (!roomIdToJoin.trim()) {
      setError('请输入房间号');
      return;
    }

    setUseRelay(false);
    setConnectionMode('connecting');
    if (!socketRef.current) {
      initSocket();
      setTimeout(() => {
        socketRef.current?.emit('join-room', roomIdToJoin.toUpperCase());
      }, 500);
    } else {
      socketRef.current.emit('join-room', roomIdToJoin.toUpperCase());
    }
  }, [initSocket]);

  const disconnect = useCallback(() => {
    clearConnectionTimeout();
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setIsInRoom(false);
    setRoomId('');
    setPeerStatus('disconnected');
    setSocketStatus('disconnected');
    setFiles([]);
    setUseRelay(false);
    setConnectionMode('connecting');
  }, [clearConnectionTimeout]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    socketStatus,
    peerStatus,
    roomId,
    isInRoom,
    files,
    error,
    useRelay,
    connectionMode,
    createRoom,
    joinRoom,
    sendFile,
    disconnect,
    setError,
  };
}

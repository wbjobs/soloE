import { useState, useCallback, useRef, useEffect } from 'react';
import { getSocket } from '../utils/socket';
import { SignalingMessage, PacketRecord, WebRTCState } from '../types';

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

const MAX_ICE_RETRIES = 3;
const ICE_RETRY_DELAY = 2000;
const CONNECTION_TIMEOUT = 30000;

export function useWebRTC(peerId: string, roomId: string) {
  const [state, setState] = useState<WebRTCState>({
    peerId,
    roomId,
    isConnected: false,
    isChannelOpen: false,
    connectionState: '',
    iceConnectionState: '',
    remotePeerId: null
  });
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const socketRef = useRef(getSocket());
  const packetRecordsRef = useRef<PacketRecord[]>([]);
  const seqCounterRef = useRef(0);
  const onPacketReceivedRef = useRef<((record: PacketRecord) => void) | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const iceRetryCountRef = useRef(0);
  const connectionTimeoutRef = useRef<number | null>(null);
  const remoteDescriptionSetRef = useRef(false);
  const reconnectAttemptRef = useRef(0);

  const clearConnectionTimeout = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  }, []);

  const startConnectionTimeout = useCallback(() => {
    clearConnectionTimeout();
    connectionTimeoutRef.current = window.setTimeout(() => {
      if (peerConnectionRef.current && peerConnectionRef.current.iceConnectionState !== 'connected' &&
          peerConnectionRef.current.iceConnectionState !== 'completed') {
        console.warn('Connection timeout, attempting ICE restart...');
        handleIceFailure();
      }
    }, CONNECTION_TIMEOUT);
  }, [clearConnectionTimeout]);

  const handleIceFailure = useCallback(async () => {
    if (iceRetryCountRef.current >= MAX_ICE_RETRIES) {
      setConnectionError('连接失败：无法穿透 NAT，请检查网络或使用 VPN');
      setIsReconnecting(false);
      return;
    }

    iceRetryCountRef.current++;
    console.log(`ICE connection retry ${iceRetryCountRef.current}/${MAX_ICE_RETRIES}`);

    if (peerConnectionRef.current) {
      try {
        await peerConnectionRef.current.restartIce();
        startConnectionTimeout();
      } catch (err) {
        console.error('ICE restart failed:', err);
        setTimeout(handleIceFailure, ICE_RETRY_DELAY);
      }
    }
  }, [startConnectionTimeout]);

  const cleanupPeerConnection = useCallback(() => {
    clearConnectionTimeout();
    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch (e) {}
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (e) {}
      peerConnectionRef.current = null;
    }
    pendingCandidatesRef.current = [];
    remoteDescriptionSetRef.current = false;
  }, [clearConnectionTimeout]);

  const flushPendingCandidates = useCallback(async () => {
    if (!peerConnectionRef.current || !remoteDescriptionSetRef.current) return;

    while (pendingCandidatesRef.current.length > 0) {
      const candidate = pendingCandidatesRef.current.shift();
      if (candidate) {
        try {
          await peerConnectionRef.current.addIceCandidate(candidate);
        } catch (err) {
          console.warn('Failed to add buffered ICE candidate:', err);
        }
      }
    }
  }, []);

  const setupDataChannel = useCallback((channel: RTCDataChannel) => {
    dataChannelRef.current = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      setState((prev) => ({ ...prev, isChannelOpen: true }));
      setConnectionError(null);
      setIsReconnecting(false);
      iceRetryCountRef.current = 0;
      reconnectAttemptRef.current = 0;
      clearConnectionTimeout();
      console.log('Data channel opened');
    };

    channel.onclose = () => {
      setState((prev) => ({ ...prev, isChannelOpen: false }));
      console.log('Data channel closed');
    };

    channel.onerror = (event) => {
      console.error('Data channel error:', event);
      setConnectionError('数据通道发生错误');
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'probe' && typeof data.seq === 'number') {
          const recvTime = Date.now();
          const record: PacketRecord = {
            seq: data.seq,
            sendTime: data.sendTime,
            recvTime,
            latency: recvTime - data.sendTime,
            size: event.data.length
          };
          packetRecordsRef.current.push(record);
          if (onPacketReceivedRef.current) {
            onPacketReceivedRef.current(record);
          }
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };
  }, [clearConnectionTimeout]);

  const initPeerConnection = useCallback(() => {
    cleanupPeerConnection();
    iceRetryCountRef.current = 0;

    const pc = new RTCPeerConnection(ICE_CONFIG);
    peerConnectionRef.current = pc;

    pc.onconnectionstatechange = () => {
      const connectionState = pc.connectionState;
      setState((prev) => ({ ...prev, connectionState }));

      if (connectionState === 'connected') {
        setState((prev) => ({ ...prev, isConnected: true }));
        setConnectionError(null);
        setIsReconnecting(false);
        clearConnectionTimeout();
      } else if (connectionState === 'disconnected') {
        setState((prev) => ({ ...prev, isConnected: false, isChannelOpen: false }));
        if (reconnectAttemptRef.current < MAX_ICE_RETRIES) {
          reconnectAttemptRef.current++;
          setIsReconnecting(true);
          console.log(`Connection lost, attempting reconnection ${reconnectAttemptRef.current}/${MAX_ICE_RETRIES}`);
          setTimeout(() => {
            if (state.remotePeerId) {
              createOffer(state.remotePeerId);
            }
          }, ICE_RETRY_DELAY);
        } else {
          setConnectionError('连接已断开，重连次数已达上限');
          setIsReconnecting(false);
        }
      } else if (connectionState === 'failed') {
        setState((prev) => ({ ...prev, isConnected: false, isChannelOpen: false }));
        handleIceFailure();
      } else if (connectionState === 'closed') {
        setState((prev) => ({ ...prev, isConnected: false, isChannelOpen: false }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      setState((prev) => ({ ...prev, iceConnectionState: iceState }));

      if (iceState === 'failed') {
        handleIceFailure();
      } else if (iceState === 'connected' || iceState === 'completed') {
        clearConnectionTimeout();
        iceRetryCountRef.current = 0;
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', pc.iceGatheringState);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && state.remotePeerId) {
        socketRef.current.emit('signal', {
          type: 'candidate',
          from: peerId,
          to: state.remotePeerId,
          data: event.candidate
        } as SignalingMessage);
      }
    };

    pc.onicecandidateerror = (event) => {
      console.warn('ICE candidate error:', event);
    };

    pc.ondatachannel = (event) => {
      setupDataChannel(event.channel);
    };

    pc.onsignalingstatechange = () => {
      console.log('Signaling state:', pc.signalingState);
    };

    return pc;
  }, [peerId, state.remotePeerId, cleanupPeerConnection, clearConnectionTimeout, handleIceFailure, setupDataChannel]);

  const createOffer = useCallback(async (remotePeerId: string) => {
    const pc = initPeerConnection();
    setState((prev) => ({ ...prev, remotePeerId }));
    setConnectionError(null);
    setIsReconnecting(true);

    try {
      const channel = pc.createDataChannel('probe-channel', {
        ordered: true,
        maxRetransmits: 3
      });
      setupDataChannel(channel);

      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
        iceRestart: reconnectAttemptRef.current > 0
      });
      await pc.setLocalDescription(offer);

      socketRef.current.emit('signal', {
        type: 'offer',
        from: peerId,
        to: remotePeerId,
        data: offer
      } as SignalingMessage);

      startConnectionTimeout();
    } catch (err) {
      console.error('Failed to create offer:', err);
      setConnectionError('创建连接邀请失败：' + (err as Error).message);
      setIsReconnecting(false);
    }
  }, [initPeerConnection, peerId, setupDataChannel, startConnectionTimeout]);

  const handleOffer = useCallback(async (message: SignalingMessage) => {
    const pc = initPeerConnection();
    setState((prev) => ({ ...prev, remotePeerId: message.from }));
    setConnectionError(null);
    setIsReconnecting(true);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(message.data));
      remoteDescriptionSetRef.current = true;
      flushPendingCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current.emit('signal', {
        type: 'answer',
        from: peerId,
        to: message.from,
        data: answer
      } as SignalingMessage);

      startConnectionTimeout();
    } catch (err) {
      console.error('Failed to handle offer:', err);
      setConnectionError('处理连接邀请失败：' + (err as Error).message);
      setIsReconnecting(false);
    }
  }, [initPeerConnection, peerId, flushPendingCandidates, startConnectionTimeout]);

  const handleAnswer = useCallback(async (message: SignalingMessage) => {
    if (peerConnectionRef.current) {
      try {
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(message.data)
        );
        remoteDescriptionSetRef.current = true;
        flushPendingCandidates();
      } catch (err) {
        console.error('Failed to handle answer:', err);
        setConnectionError('处理连接响应失败：' + (err as Error).message);
      }
    }
  }, [flushPendingCandidates]);

  const handleCandidate = useCallback(async (message: SignalingMessage) => {
    if (peerConnectionRef.current) {
      if (remoteDescriptionSetRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(message.data));
        } catch (err) {
          console.warn('Failed to add ICE candidate:', err);
        }
      } else {
        pendingCandidatesRef.current.push(new RTCIceCandidate(message.data));
        console.log('Buffered ICE candidate (remote description not set yet)');
      }
    }
  }, []);

  const sendProbePacket = useCallback(() => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      const seq = seqCounterRef.current++;
      const packet = {
        type: 'probe',
        seq,
        sendTime: Date.now()
      };
      try {
        dataChannelRef.current.send(JSON.stringify(packet));
        return seq;
      } catch (err) {
        console.error('Failed to send probe packet:', err);
        return -1;
      }
    }
    return -1;
  }, []);

  const getPacketRecords = useCallback(() => {
    return [...packetRecordsRef.current];
  }, []);

  const clearPacketRecords = useCallback(() => {
    packetRecordsRef.current = [];
    seqCounterRef.current = 0;
  }, []);

  const setOnPacketReceived = useCallback((callback: (record: PacketRecord) => void) => {
    onPacketReceivedRef.current = callback;
  }, []);

  const resetConnection = useCallback(() => {
    cleanupPeerConnection();
    setState({
      peerId,
      roomId,
      isConnected: false,
      isChannelOpen: false,
      connectionState: '',
      iceConnectionState: '',
      remotePeerId: null
    });
    setConnectionError(null);
    setIsReconnecting(false);
    iceRetryCountRef.current = 0;
    reconnectAttemptRef.current = 0;
  }, [peerId, roomId, cleanupPeerConnection]);

  useEffect(() => {
    const socket = socketRef.current;

    socket.emit('join-room', { roomId, peerId });

    const onSignal = (message: SignalingMessage) => {
      if (message.to !== peerId) return;

      switch (message.type) {
        case 'offer':
          handleOffer(message);
          break;
        case 'answer':
          handleAnswer(message);
          break;
        case 'candidate':
          handleCandidate(message);
          break;
      }
    };

    socket.on('signal', onSignal);

    return () => {
      socket.off('signal', onSignal);
      cleanupPeerConnection();
    };
  }, [roomId, peerId, handleOffer, handleAnswer, handleCandidate, cleanupPeerConnection]);

  return {
    state,
    connectionError,
    isReconnecting,
    createOffer,
    sendProbePacket,
    getPacketRecords,
    clearPacketRecords,
    setOnPacketReceived,
    resetConnection
  };
}

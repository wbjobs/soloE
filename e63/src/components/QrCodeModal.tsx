import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { QrCodePayload } from '../types';

interface QrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceName: string;
  onConnect: (payload: QrCodePayload) => void;
}

export default function QrCodeModal({ isOpen, onClose, deviceName, onConnect }: QrCodeModalProps) {
  const [mode, setMode] = useState<'generate' | 'scan'>('generate');
  const [qrPayload, setQrPayload] = useState<string>('');
  const [signalingUrl, setSignalingUrl] = useState<string>('');
  const scannerRef = useRef<HTMLDivElement>(null);
  const scannerInstanceRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    if (isOpen && mode === 'generate') {
      generateQrCode();
    }
  }, [isOpen, mode]);

  useEffect(() => {
    if (isOpen && mode === 'scan' && scannerRef.current) {
      initScanner();
    }
    return () => {
      if (scannerInstanceRef.current) {
        scannerInstanceRef.current.clear().catch(console.error);
        scannerInstanceRef.current = null;
      }
    };
  }, [isOpen, mode]);

  const generateQrCode = async () => {
    try {
      const url = await invoke<string>('start_signaling', {
        deviceName,
        port: 8888,
      });
      setSignalingUrl(url);

      const payload = await invoke<string>('get_qrcode_payload', {
        deviceName,
        port: 8888,
      });
      setQrPayload(payload);
    } catch (error) {
      console.error('Failed to generate QR code:', error);
    }
  };

  const initScanner = () => {
    if (!scannerRef.current || scannerInstanceRef.current) return;

    const scanner = new Html5QrcodeScanner(
      'qr-reader',
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false
    );

    scanner.render(
      (decodedText) => {
        try {
          const payload: QrCodePayload = JSON.parse(decodedText);
          onConnect(payload);
          onClose();
        } catch (e) {
          console.error('Failed to parse QR code:', e);
        }
      },
      () => {}
    );

    scannerInstanceRef.current = scanner;
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>设备连接</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="mode-tabs">
          <button
            className={`mode-tab ${mode === 'generate' ? 'active' : ''}`}
            onClick={() => setMode('generate')}
          >
            生成二维码
          </button>
          <button
            className={`mode-tab ${mode === 'scan' ? 'active' : ''}`}
            onClick={() => setMode('scan')}
          >
            扫描二维码
          </button>
        </div>

        <div className="modal-body">
          {mode === 'generate' ? (
            <div className="qr-generate">
              <p className="qr-hint">其他设备扫描此二维码以连接</p>
              {qrPayload ? (
                <div className="qr-container">
                  <QRCodeSVG value={qrPayload} size={256} level="H" />
                </div>
              ) : (
                <div className="loading">正在生成...</div>
              )}
              {signalingUrl && (
                <p className="signaling-url">信令服务器: {signalingUrl}</p>
              )}
            </div>
          ) : (
            <div className="qr-scan">
              <p className="qr-hint">扫描其他设备的二维码</p>
              <div id="qr-reader" ref={scannerRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

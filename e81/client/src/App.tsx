import { useState, useRef } from 'react';
import axios, { AxiosProgressEvent } from 'axios';

type Tab = 'encode' | 'decode';

interface EncodeResult {
  success: boolean;
  message: string;
  data?: Blob;
  downloadUrl?: string;
}

interface DecodeResult {
  success: boolean;
  message: string;
  text: string;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 100000;

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('encode');
  
  const [encodeFile, setEncodeFile] = useState<File | null>(null);
  const [encodeText, setEncodeText] = useState('');
  const [encodePreview, setEncodePreview] = useState<string>('');
  const [encodeResult, setEncodeResult] = useState<EncodeResult | null>(null);
  const [encodeLoading, setEncodeLoading] = useState(false);
  const [encodeProgress, setEncodeProgress] = useState(0);
  const [encodeFileError, setEncodeFileError] = useState<string>('');
  const [useEncryption, setUseEncryption] = useState(false);
  const [encodePassword, setEncodePassword] = useState('');
  const [showEncodePassword, setShowEncodePassword] = useState(false);
  
  const [decodeFile, setDecodeFile] = useState<File | null>(null);
  const [decodePreview, setDecodePreview] = useState<string>('');
  const [decodeResult, setDecodeResult] = useState<DecodeResult | null>(null);
  const [decodeLoading, setDecodeLoading] = useState(false);
  const [decodeProgress, setDecodeProgress] = useState(0);
  const [decodeFileError, setDecodeFileError] = useState<string>('');
  const [decodePassword, setDecodePassword] = useState('');
  const [showDecodePassword, setShowDecodePassword] = useState(false);
  const [originalText, setOriginalText] = useState('');
  const [showComparison, setShowComparison] = useState(false);
  
  const encodeFileInput = useRef<HTMLInputElement>(null);
  const decodeFileInput = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string => {
    if (file.type !== 'image/png') {
      return '只支持 PNG 格式的图片';
    }
    if (file.size > MAX_FILE_SIZE) {
      return `文件过大 (${(file.size / 1024 / 1024).toFixed(2)}MB)，最大允许 ${MAX_FILE_SIZE / 1024 / 1024}MB`;
    }
    return '';
  };

  const handleEncodeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const error = validateFile(file);
      if (error) {
        setEncodeFileError(error);
        setEncodeFile(null);
        setEncodePreview('');
        return;
      }
      
      setEncodeFileError('');
      setEncodeFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => {
        setEncodePreview(ev.target?.result as string);
      };
      reader.readAsDataURL(file);
      setEncodeResult(null);
    }
  };

  const handleDecodeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const error = validateFile(file);
      if (error) {
        setDecodeFileError(error);
        setDecodeFile(null);
        setDecodePreview('');
        return;
      }
      
      setDecodeFileError('');
      setDecodeFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => {
        setDecodePreview(ev.target?.result as string);
      };
      reader.readAsDataURL(file);
      setDecodeResult(null);
      setShowComparison(false);
    }
  };

  const handleEncode = async () => {
    if (!encodeFile || !encodeText.trim()) {
      return;
    }
    
    if (useEncryption && !encodePassword.trim()) {
      return;
    }
    
    setEncodeLoading(true);
    setEncodeProgress(0);
    setEncodeResult(null);
    
    try {
      const formData = new FormData();
      formData.append('image', encodeFile);
      formData.append('text', encodeText);
      formData.append('useEncryption', useEncryption.toString());
      if (useEncryption) {
        formData.append('password', encodePassword);
      }
      
      const response = await axios.post('/api/encode', formData, {
        responseType: 'blob',
        onUploadProgress: (progressEvent: AxiosProgressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setEncodeProgress(percentCompleted);
          }
        },
      });
      
      const url = URL.createObjectURL(response.data);
      const encrypted = response.headers['x-encrypted'] === 'true';
      setEncodeResult({
        success: true,
        message: `编码成功！${encrypted ? '已使用 AES-256-GCM 加密' : '未加密'}，已嵌入 ${encodeText.length} 个字符`,
        data: response.data,
        downloadUrl: url,
      });
      setEncodeProgress(100);
    } catch (error: any) {
      let errorMessage = '编码失败';
      if (error.response?.data) {
        try {
          const reader = new FileReader();
          reader.onload = () => {
            const result = JSON.parse(reader.result as string);
            setEncodeResult({
              success: false,
              message: result.message || errorMessage,
            });
          };
          reader.readAsText(error.response.data);
          return;
        } catch {
          errorMessage = error.message || errorMessage;
        }
      }
      setEncodeResult({
        success: false,
        message: errorMessage,
      });
    } finally {
      setEncodeLoading(false);
    }
  };

  const handleDecode = async () => {
    if (!decodeFile) {
      return;
    }
    
    setDecodeLoading(true);
    setDecodeProgress(0);
    setDecodeResult(null);
    
    try {
      const formData = new FormData();
      formData.append('image', decodeFile);
      if (decodePassword.trim()) {
        formData.append('password', decodePassword);
      }
      
      const response = await axios.post('/api/decode', formData, {
        onUploadProgress: (progressEvent: AxiosProgressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setDecodeProgress(percentCompleted);
          }
        },
      });
      
      setDecodeResult(response.data);
      setDecodeProgress(100);
    } catch (error: any) {
      setDecodeResult({
        success: false,
        message: error.response?.data?.message || error.message || '解码失败',
        text: '',
      });
    } finally {
      setDecodeLoading(false);
    }
  };

  const handleCompare = () => {
    setShowComparison(true);
  };

  const areTextsEqual = originalText.trim() === decodeResult?.text?.trim();

  const clearEncode = () => {
    setEncodeFile(null);
    setEncodeText('');
    setEncodePreview('');
    setEncodeResult(null);
    setEncodeProgress(0);
    setEncodeFileError('');
    setUseEncryption(false);
    setEncodePassword('');
    if (encodeResult?.downloadUrl) {
      URL.revokeObjectURL(encodeResult.downloadUrl);
    }
    if (encodeFileInput.current) {
      encodeFileInput.current.value = '';
    }
  };

  const clearDecode = () => {
    setDecodeFile(null);
    setDecodePreview('');
    setDecodeResult(null);
    setDecodeProgress(0);
    setDecodeFileError('');
    setDecodePassword('');
    setOriginalText('');
    setShowComparison(false);
    if (decodeFileInput.current) {
      decodeFileInput.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  return (
    <div className="app">
      <div className="header">
        <h1>🔐 PNG 隐写工具</h1>
        <p>将文本信息隐藏在 PNG 图片中，支持中文文本和 AES-256-GCM 加密</p>
      </div>

      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === 'encode' ? 'active' : ''}`}
          onClick={() => setActiveTab('encode')}
        >
          编码
        </button>
        <button
          className={`tab-btn ${activeTab === 'decode' ? 'active' : ''}`}
          onClick={() => setActiveTab('decode')}
        >
          解码
        </button>
      </div>

      <div className="card">
        {activeTab === 'encode' && (
          <div>
            <h2 style={{ marginBottom: '20px', color: '#333' }}>📤 编码 - 将文本嵌入图片</h2>
            
            <div className="form-group">
              <label>选择 PNG 图片 <span style={{ color: '#999', fontWeight: 'normal' }}>(最大 5MB)</span></label>
              <input
                ref={encodeFileInput}
                type="file"
                accept="image/png"
                className="file-input"
                onChange={handleEncodeFileChange}
              />
              {encodeFileError && (
                <div className="error-message">{encodeFileError}</div>
              )}
            </div>

            {encodePreview && (
              <div className="preview">
                <img src={encodePreview} alt="Preview" />
                <p style={{ marginTop: '10px', color: '#666' }}>
                  {encodeFile?.name} ({formatFileSize(encodeFile!.size)})
                </p>
              </div>
            )}

            <div className="form-group" style={{ marginTop: '20px' }}>
              <label>要隐藏的文本（支持中文）</label>
              <textarea
                className="textarea"
                placeholder="在此输入要隐藏的文本..."
                value={encodeText}
                onChange={(e) => setEncodeText(e.target.value.slice(0, MAX_TEXT_LENGTH))}
                maxLength={MAX_TEXT_LENGTH}
              />
              <p style={{ marginTop: '8px', color: '#888', fontSize: '0.9rem' }}>
                字符数：{encodeText.length} / {MAX_TEXT_LENGTH} | 
                字节数：{new Blob([encodeText]).size}
              </p>
            </div>

            <div className="form-group">
              <div className="encryption-toggle">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={useEncryption}
                    onChange={(e) => setUseEncryption(e.target.checked)}
                  />
                  <span className="slider"></span>
                </label>
                <span className="encryption-label">
                  🔒 使用 AES-256-GCM 加密嵌入
                </span>
              </div>
            </div>

            {useEncryption && (
              <div className="form-group">
                <label>加密密码</label>
                <div className="password-input-wrapper">
                  <input
                    type={showEncodePassword ? 'text' : 'password'}
                    className="password-input"
                    placeholder="请输入加密密码..."
                    value={encodePassword}
                    onChange={(e) => setEncodePassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowEncodePassword(!showEncodePassword)}
                  >
                    {showEncodePassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
                <p style={{ marginTop: '8px', color: '#888', fontSize: '0.9rem' }}>
                  ⚠️ 请牢记密码，丢失后无法恢复数据
                </p>
              </div>
            )}

            {encodeLoading && (
              <div className="progress-container">
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${encodeProgress}%` }}
                  ></div>
                </div>
                <p className="progress-text">处理中... {encodeProgress}%</p>
              </div>
            )}

            <div style={{ marginTop: '20px' }}>
              <button
                className="btn btn-primary"
                onClick={handleEncode}
                disabled={!encodeFile || !encodeText.trim() || encodeLoading || !!encodeFileError || (useEncryption && !encodePassword.trim())}
              >
                {encodeLoading ? (
                  <>
                    <span className="spinner" style={{ display: 'inline-block', marginRight: '8px' }}></span>
                    编码中...
                  </>
                ) : '开始编码'}
              </button>
              <button className="btn btn-secondary" onClick={clearEncode}>
                清除
              </button>
            </div>

            {encodeResult && (
              <div className={`result ${encodeResult.success ? 'success' : 'error'}`}>
                <h3>{encodeResult.success ? '✅ 成功' : '❌ 失败'}</h3>
                <p>{encodeResult.message}</p>
                {encodeResult.success && encodeResult.downloadUrl && (
                  <a
                    className="download-link"
                    href={encodeResult.downloadUrl}
                    download="encoded.png"
                  >
                    📥 下载编码后的图片
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'decode' && (
          <div>
            <h2 style={{ marginBottom: '20px', color: '#333' }}>📥 解码 - 从图片中提取文本</h2>
            
            <div className="form-group">
              <label>选择已编码的 PNG 图片 <span style={{ color: '#999', fontWeight: 'normal' }}>(最大 5MB)</span></label>
              <input
                ref={decodeFileInput}
                type="file"
                accept="image/png"
                className="file-input"
                onChange={handleDecodeFileChange}
              />
              {decodeFileError && (
                <div className="error-message">{decodeFileError}</div>
              )}
            </div>

            {decodePreview && (
              <div className="preview">
                <img src={decodePreview} alt="Preview" />
                <p style={{ marginTop: '10px', color: '#666' }}>
                  {decodeFile?.name} ({formatFileSize(decodeFile!.size)})
                </p>
              </div>
            )}

            <div className="form-group">
              <label>解密密码 <span style={{ color: '#999', fontWeight: 'normal' }}>(如果数据已加密)</span></label>
              <div className="password-input-wrapper">
                <input
                  type={showDecodePassword ? 'text' : 'password'}
                  className="password-input"
                  placeholder="请输入解密密码（如未加密可留空）..."
                  value={decodePassword}
                  onChange={(e) => setDecodePassword(e.target.value)}
                />
                <button
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowDecodePassword(!showDecodePassword)}
                >
                  {showDecodePassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
            </div>

            {decodeLoading && (
              <div className="progress-container">
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${decodeProgress}%` }}
                  ></div>
                </div>
                <p className="progress-text">处理中... {decodeProgress}%</p>
              </div>
            )}

            <div style={{ marginTop: '20px' }}>
              <button
                className="btn btn-primary"
                onClick={handleDecode}
                disabled={!decodeFile || decodeLoading || !!decodeFileError}
              >
                {decodeLoading ? (
                  <>
                    <span className="spinner" style={{ display: 'inline-block', marginRight: '8px' }}></span>
                    解码中...
                  </>
                ) : '开始解码'}
              </button>
              <button className="btn btn-secondary" onClick={clearDecode}>
                清除
              </button>
            </div>

            {decodeResult && (
              <div className={`result ${decodeResult.success ? 'success' : 'error'}`}>
                <h3>{decodeResult.success ? '✅ 解码成功' : '❌ 解码失败'}</h3>
                <p>{decodeResult.message}</p>
                {decodeResult.success && decodeResult.text && (
                  <div>
                    <div className="result-text" style={{ marginTop: '10px' }}>
                      {decodeResult.text}
                    </div>
                    
                    <div className="form-group" style={{ marginTop: '20px' }}>
                      <label>输入原始文本进行对比（可选）</label>
                      <textarea
                        className="textarea"
                        placeholder="在此输入原始文本以进行对比..."
                        value={originalText}
                        onChange={(e) => setOriginalText(e.target.value)}
                      />
                    </div>
                    
                    <button
                      className="btn btn-primary"
                      onClick={handleCompare}
                      disabled={!originalText.trim()}
                      style={{ marginTop: '10px' }}
                    >
                      对比文本
                    </button>
                  </div>
                )}
              </div>
            )}

            {showComparison && decodeResult?.success && originalText && (
              <div className="comparison">
                <div className="comparison-item original">
                  <h4>📝 原始文本</h4>
                  <div className="result-text">{originalText}</div>
                </div>
                <div className="comparison-item extracted">
                  <h4>🔍 提取文本</h4>
                  <div className="result-text">{decodeResult.text}</div>
                </div>
              </div>
            )}

            {showComparison && decodeResult?.success && originalText && (
              <div className="diff">
                <h4>
                  {areTextsEqual ? '✅ 文本完全一致' : '⚠️ 文本存在差异'}
                </h4>
                <p>
                  原始文本长度：{originalText.length} 字符 | 
                  提取文本长度：{decodeResult.text.length} 字符
                </p>
                {!areTextsEqual && (
                  <p style={{ marginTop: '10px', color: '#856404' }}>
                    提示：请检查是否有隐藏字符或编码问题，或密码是否正确
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center', marginTop: '30px', color: 'rgba(255,255,255,0.8)' }}>
        <p>💡 提示：隐写技术可用于版权保护、秘密通信等场景 | 最大文件大小：5MB | 支持 AES-256-GCM 加密</p>
      </div>
    </div>
  );
}

export default App;

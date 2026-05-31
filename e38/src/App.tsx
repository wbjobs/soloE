import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

interface BootEntry {
  id: string;
  name: string;
  partition: string;
  disk: string;
  active: boolean;
  order: number;
}

interface SecureBootCertificate {
  id: string;
  name: string;
  issuer: string;
  subject: string;
  serial_number: string;
  fingerprint: string;
  valid_from: string;
  valid_to: string;
  signature_type: string;
  is_microsoft: boolean;
  database: string;
}

type TabType = "boot" | "secureboot";

function App() {
  const [activeTab, setActiveTab] = useState<TabType>("boot");
  
  const [bootEntries, setBootEntries] = useState<BootEntry[]>([]);
  const [bootLoading, setBootLoading] = useState(true);
  
  const [certificates, setCertificates] = useState<SecureBootCertificate[]>([]);
  const [secureBootEnabled, setSecureBootEnabled] = useState<boolean | null>(null);
  const [certLoading, setCertLoading] = useState(true);
  
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{cert: SecureBootCertificate, show: boolean} | null>(null);
  const [newEntry, setNewEntry] = useState<Partial<BootEntry>>({
    name: "",
    partition: "",
    disk: "",
  });

  const loadBootEntries = async () => {
    try {
      setBootLoading(true);
      setError(null);
      const entries = await invoke<BootEntry[]>("get_boot_entries");
      setBootEntries(entries);
    } catch (err) {
      setError(String(err));
    } finally {
      setBootLoading(false);
    }
  };

  const loadSecureBootStatus = async () => {
    try {
      const enabled = await invoke<boolean>("is_secure_boot_enabled");
      setSecureBootEnabled(enabled);
    } catch (err) {
      console.error("Failed to get secure boot status:", err);
    }
  };

  const loadCertificates = async () => {
    try {
      setCertLoading(true);
      setError(null);
      const certs = await invoke<SecureBootCertificate[]>("get_secure_boot_certificates");
      setCertificates(certs);
    } catch (err) {
      setError(String(err));
    } finally {
      setCertLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "boot") {
      loadBootEntries();
    } else if (activeTab === "secureboot") {
      loadSecureBootStatus();
      loadCertificates();
    }
  }, [activeTab]);

  const handleBackup = async () => {
    try {
      const path = await open({
        title: "备份EFI配置",
        multiple: false,
        filters: [{
          name: "JSON",
          extensions: ["json"]
        }]
      });
      if (path) {
        await invoke("backup_efi_config", { path: path.toString() });
        alert("备份成功！");
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleRestore = async () => {
    try {
      const path = await open({
        title: "恢复EFI配置",
        multiple: false,
        filters: [{
          name: "JSON",
          extensions: ["json"]
        }]
      });
      if (path) {
        await invoke("restore_efi_config", { path: path.toString() });
        alert("恢复成功！");
        loadBootEntries();
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    const newEntries = [...bootEntries];
    [newEntries[index - 1], newEntries[index]] = [newEntries[index], newEntries[index - 1]];
    newEntries.forEach((entry, i) => entry.order = i);
    setBootEntries(newEntries);

    const order = newEntries.map(e => e.id);
    try {
      await invoke("set_boot_order", { order });
    } catch (err) {
      setError(String(err));
      loadBootEntries();
    }
  };

  const handleMoveDown = async (index: number) => {
    if (index === bootEntries.length - 1) return;
    const newEntries = [...bootEntries];
    [newEntries[index], newEntries[index + 1]] = [newEntries[index + 1], newEntries[index]];
    newEntries.forEach((entry, i) => entry.order = i);
    setBootEntries(newEntries);

    const order = newEntries.map(e => e.id);
    try {
      await invoke("set_boot_order", { order });
    } catch (err) {
      setError(String(err));
      loadBootEntries();
    }
  };

  const handleDeleteBootEntry = async (entryId: string) => {
    if (!confirm("确定要删除这个启动项吗？")) return;
    try {
      await invoke("delete_boot_entry", { entryId });
      loadBootEntries();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleAddEntry = async () => {
    if (!newEntry.name || !newEntry.partition || !newEntry.disk) {
      setError("请填写所有字段");
      return;
    }
    try {
      const entry: BootEntry = {
        id: Date.now().toString(16).toUpperCase(),
        name: newEntry.name,
        partition: newEntry.partition,
        disk: newEntry.disk,
        active: true,
        order: bootEntries.length,
      };
      await invoke("add_boot_entry", { entry });
      setShowAddDialog(false);
      setNewEntry({ name: "", partition: "", disk: "" });
      loadBootEntries();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleImportCertificate = async () => {
    try {
      const path = await open({
        title: "导入安全启动证书",
        multiple: false,
        filters: [{
          name: "证书文件",
          extensions: ["cer", "der", "crt", "pem"]
        }]
      });
      if (path) {
        await invoke("import_secure_boot_certificate", { 
          certPath: path.toString(),
          dbType: "db"
        });
        alert("证书导入成功！重启后生效。");
        loadCertificates();
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDeleteCertificate = async (cert: SecureBootCertificate, confirmed: boolean) => {
    try {
      await invoke("delete_secure_boot_certificate", { 
        certId: cert.id,
        confirmMicrosoft: confirmed
      });
      alert("证书删除成功！重启后生效。");
      setShowDeleteConfirm(null);
      loadCertificates();
    } catch (err: any) {
      if (err.includes("Microsoft certificate deletion requires confirmation")) {
        setShowDeleteConfirm({ cert, show: true });
      } else {
        setError(String(err));
      }
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1>UEFI 启动管理器</h1>
        <div className="tab-nav">
          <button 
            className={`tab-btn ${activeTab === "boot" ? "active" : ""}`}
            onClick={() => setActiveTab("boot")}
          >
            启动项管理
          </button>
          <button 
            className={`tab-btn ${activeTab === "secureboot" ? "active" : ""}`}
            onClick={() => setActiveTab("secureboot")}
          >
            安全启动证书
          </button>
        </div>
      </header>

      {error && (
        <div className="error" onClick={() => setError(null)}>
          {error}
          <span className="close-btn">×</span>
        </div>
      )}

      {activeTab === "boot" && (
        <div className="boot-tab">
          <div className="toolbar">
            <button onClick={loadBootEntries} disabled={bootLoading}>
              刷新
            </button>
            <button onClick={() => setShowAddDialog(true)}>
              添加启动项
            </button>
            <button onClick={handleBackup}>备份配置</button>
            <button onClick={handleRestore}>恢复配置</button>
          </div>

          {bootLoading ? (
            <div className="loading">加载中...</div>
          ) : (
            <div className="boot-list">
              <h2>启动项列表 ({bootEntries.length})</h2>
              {bootEntries.length === 0 ? (
                <p className="empty-state">没有找到启动项</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>顺序</th>
                      <th>名称</th>
                      <th>分区</th>
                      <th>磁盘</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bootEntries.map((entry, index) => (
                      <tr key={entry.id}>
                        <td className="order-cell">#{entry.order + 1}</td>
                        <td className="name-cell">{entry.name}</td>
                        <td className="path-cell">{entry.partition}</td>
                        <td className="path-cell">{entry.disk}</td>
                        <td>
                          <span className={`status-badge ${entry.active ? "active" : "inactive"}`}>
                            {entry.active ? "激活" : "未激活"}
                          </span>
                        </td>
                        <td className="actions-cell">
                          <button
                            className="btn-small"
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0}
                          >
                            ↑
                          </button>
                          <button
                            className="btn-small"
                            onClick={() => handleMoveDown(index)}
                            disabled={index === bootEntries.length - 1}
                          >
                            ↓
                          </button>
                          <button
                            className="btn-small btn-danger"
                            onClick={() => handleDeleteBootEntry(entry.id)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "secureboot" && (
        <div className="secureboot-tab">
          <div className="secureboot-status">
            <div className="status-card">
              <h3>安全启动状态</h3>
              <div className={`status-indicator ${secureBootEnabled ? "enabled" : "disabled"}`}>
                {secureBootEnabled === null ? "检测中..." : secureBootEnabled ? "已启用" : "未启用"}
              </div>
            </div>
          </div>

          <div className="toolbar">
            <button onClick={loadCertificates} disabled={certLoading}>
              刷新
            </button>
            <button onClick={handleImportCertificate} className="btn-primary">
              导入证书 (.cer/.der)
            </button>
          </div>

          {certLoading ? (
            <div className="loading">加载证书中...</div>
          ) : (
            <div className="cert-list">
              <h2>已安装的安全启动证书 ({certificates.length})</h2>
              
              {certificates.filter(c => c.database === "db").length > 0 && (
                <div className="cert-section">
                  <h3>
                    <span className="db-badge db">db</span> 白名单证书
                  </h3>
                  <div className="cert-grid">
                    {certificates.filter(c => c.database === "db").map((cert) => (
                      <div key={cert.id} className={`cert-card ${cert.is_microsoft ? "microsoft" : ""}`}>
                        <div className="cert-header">
                          <h4 title={cert.name}>{cert.name}</h4>
                          {cert.is_microsoft && (
                            <span className="microsoft-badge">Microsoft</span>
                          )}
                        </div>
                        <div className="cert-details">
                          <div className="cert-field">
                            <span className="label">指纹:</span>
                            <span className="value fingerprint">{cert.fingerprint}</span>
                          </div>
                          <div className="cert-field">
                            <span className="label">序列号:</span>
                            <span className="value">{cert.serial_number}</span>
                          </div>
                          <div className="cert-field">
                            <span className="label">有效期:</span>
                            <span className="value">{cert.valid_from} ~ {cert.valid_to}</span>
                          </div>
                          <div className="cert-field">
                            <span className="label">签名类型:</span>
                            <span className="value">{cert.signature_type}</span>
                          </div>
                          <div className="cert-field">
                            <span className="label">颁发者:</span>
                            <span className="value issuer" title={cert.issuer}>{cert.issuer}</span>
                          </div>
                        </div>
                        <div className="cert-actions">
                          <button 
                            className="btn-small btn-danger"
                            onClick={() => handleDeleteCertificate(cert, false)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {certificates.filter(c => c.database === "dbx").length > 0 && (
                <div className="cert-section">
                  <h3>
                    <span className="db-badge dbx">dbx</span> 黑名单证书
                  </h3>
                  <div className="cert-grid">
                    {certificates.filter(c => c.database === "dbx").map((cert) => (
                      <div key={cert.id} className={`cert-card ${cert.is_microsoft ? "microsoft" : ""}`}>
                        <div className="cert-header">
                          <h4 title={cert.name}>{cert.name}</h4>
                          {cert.is_microsoft && (
                            <span className="microsoft-badge">Microsoft</span>
                          )}
                        </div>
                        <div className="cert-details">
                          <div className="cert-field">
                            <span className="label">指纹:</span>
                            <span className="value fingerprint">{cert.fingerprint}</span>
                          </div>
                          <div className="cert-field">
                            <span className="label">序列号:</span>
                            <span className="value">{cert.serial_number}</span>
                          </div>
                          <div className="cert-field">
                            <span className="label">有效期:</span>
                            <span className="value">{cert.valid_from} ~ {cert.valid_to}</span>
                          </div>
                        </div>
                        <div className="cert-actions">
                          <button 
                            className="btn-small btn-danger"
                            onClick={() => handleDeleteCertificate(cert, false)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {certificates.length === 0 && (
                <p className="empty-state">没有找到安全启动证书</p>
              )}
            </div>
          )}
        </div>
      )}

      {showAddDialog && (
        <div className="dialog-overlay" onClick={() => setShowAddDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>添加新启动项</h3>
            <div className="form-group">
              <label>启动项名称</label>
              <input
                type="text"
                value={newEntry.name || ""}
                onChange={(e) => setNewEntry({ ...newEntry, name: e.target.value })}
                placeholder="例如: Windows Boot Manager"
              />
            </div>
            <div className="form-group">
              <label>分区路径</label>
              <input
                type="text"
                value={newEntry.partition || ""}
                onChange={(e) => setNewEntry({ ...newEntry, partition: e.target.value })}
                placeholder="例如: HD(1,GPT,...)"
              />
            </div>
            <div className="form-group">
              <label>磁盘设备</label>
              <input
                type="text"
                value={newEntry.disk || ""}
                onChange={(e) => setNewEntry({ ...newEntry, disk: e.target.value })}
                placeholder="例如: /dev/sda"
              />
            </div>
            <div className="dialog-actions">
              <button className="btn-secondary" onClick={() => setShowAddDialog(false)}>
                取消
              </button>
              <button className="btn-primary" onClick={handleAddEntry}>
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm?.show && (
        <div className="dialog-overlay" onClick={() => setShowDeleteConfirm(null)}>
          <div className="dialog warning-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="warning-icon">⚠️</div>
            <h3>危险操作警告</h3>
            <div className="warning-content">
              <p>您即将删除一个 <strong>Microsoft 安全启动证书</strong>。</p>
              <div className="warning-box">
                <h4>⚠️ 删除此证书可能导致：</h4>
                <ul>
                  <li>Windows 系统无法启动</li>
                  <li>无法验证驱动程序签名</li>
                  <li>无法进行系统安全更新</li>
                  <li>需要重新安装系统才能恢复</li>
                </ul>
              </div>
              <p>证书名称: <strong>{showDeleteConfirm.cert.name}</strong></p>
            </div>
            <div className="confirm-checkbox">
              <label>
                <input type="checkbox" id="confirmDelete" />
                我已了解风险并确认删除此证书
              </label>
            </div>
            <div className="dialog-actions">
              <button className="btn-secondary" onClick={() => setShowDeleteConfirm(null)}>
                取消
              </button>
              <button 
                className="btn-danger"
                onClick={() => {
                  const checkbox = document.getElementById("confirmDelete") as HTMLInputElement;
                  if (checkbox?.checked) {
                    handleDeleteCertificate(showDeleteConfirm.cert, true);
                  } else {
                    alert("请先勾选确认复选框");
                  }
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { FolderOpen, Lock, Unlock, RefreshCw, File, CheckCircle, XCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { PasswordDialog } from "@/components/PasswordDialog"
import { useFileStore, type FileInfo } from "@/store/fileStore"
import { formatFileSize } from "@/lib/utils"

type DialogMode = "encrypt" | "decrypt" | null

interface OperationResult {
  success: boolean
  message: string
}

export function FileBrowser() {
  const { files, selectedFiles, currentFolder, setFiles, setCurrentFolder, toggleFileSelection, clearSelection, selectAll } = useFileStore()
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [loading, setLoading] = useState(false)
  const [resultMessage, setResultMessage] = useState<OperationResult | null>(null)

  const handleSelectFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择文件夹",
    })

    if (selected && typeof selected === "string") {
      setCurrentFolder(selected)
      await scanFolder(selected)
    }
  }

  const scanFolder = async (path: string) => {
    setLoading(true)
    try {
      const result = await invoke<FileInfo[]>("scan_folder", { folderPath: path })
      setFiles(result)
    } catch (error) {
      console.error("扫描文件夹失败:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = () => {
    if (currentFolder) {
      scanFolder(currentFolder)
    }
  }

  const handleEncrypt = async (password: string) => {
    const selectedPaths = Array.from(selectedFiles).filter(p => {
      const file = files.find(f => f.path === p)
      return file && !file.is_encrypted
    })
    
    let successCount = 0
    let failCount = 0
    let lastError = ""

    for (const path of selectedPaths) {
      try {
        const result = await invoke<OperationResult>("encrypt", { filePath: path, password })
        if (result.success) {
          successCount++
        } else {
          failCount++
          lastError = result.message
        }
      } catch (error) {
        failCount++
        lastError = String(error)
      }
    }
    
    if (failCount === 0) {
      setResultMessage({ success: true, message: `加密成功！已处理 ${successCount} 个文件，SHA-256 哈希已保存。` })
    } else {
      setResultMessage({ success: false, message: `加密完成：成功 ${successCount} 个，失败 ${failCount} 个。最后错误：${lastError}` })
    }
    
    clearSelection()
    handleRefresh()
    setTimeout(() => setResultMessage(null), 5000)
  }

  const handleDecrypt = async (password: string) => {
    const selectedPaths = Array.from(selectedFiles).filter(p => {
      const file = files.find(f => f.path === p)
      return file && file.is_encrypted
    })
    
    let successCount = 0
    let failCount = 0
    let lastError = ""

    for (const path of selectedPaths) {
      try {
        const result = await invoke<OperationResult>("decrypt", { filePath: path, password })
        if (result.success) {
          successCount++
        } else {
          failCount++
          lastError = result.message
        }
      } catch (error) {
        failCount++
        lastError = String(error)
      }
    }
    
    if (failCount === 0) {
      setResultMessage({ success: true, message: `解密成功！已处理 ${successCount} 个文件，SHA-256 哈希验证通过，文件完整性确认。` })
    } else {
      setResultMessage({ success: false, message: `解密完成：成功 ${successCount} 个，失败 ${failCount} 个。最后错误：${lastError}` })
    }
    
    clearSelection()
    handleRefresh()
    setTimeout(() => setResultMessage(null), 8000)
  }

  const allSelected = files.length > 0 && selectedFiles.size === files.length
  const hasEncrypted = files.some((f) => f.is_encrypted && selectedFiles.has(f.path))
  const hasUnencrypted = files.some((f) => !f.is_encrypted && selectedFiles.has(f.path))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Button onClick={handleSelectFolder} className="gap-2">
            <FolderOpen className="h-4 w-4" />
            选择文件夹
          </Button>
          {currentFolder && (
            <Button variant="outline" size="icon" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedFiles.size > 0 && (
            <>
              {hasUnencrypted && (
                <Button variant="default" onClick={() => setDialogMode("encrypt")} className="gap-2">
                  <Lock className="h-4 w-4" />
                  加密 ({Array.from(selectedFiles).filter((p) => files.find((f) => f.path === p && !f.is_encrypted)).length})
                </Button>
              )}
              {hasEncrypted && (
                <Button variant="secondary" onClick={() => setDialogMode("decrypt")} className="gap-2">
                  <Unlock className="h-4 w-4" />
                  解密 ({Array.from(selectedFiles).filter((p) => files.find((f) => f.path === p && f.is_encrypted)).length})
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {currentFolder && (
        <div className="px-4 py-2 bg-muted/50 text-sm">
          当前文件夹: <span className="font-mono">{currentFolder}</span>
        </div>
      )}

      {resultMessage && (
        <div className={`px-4 py-3 flex items-center justify-between ${
          resultMessage.success 
            ? "bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800" 
            : "bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800"
        }`}>
          <div className="flex items-center gap-2">
            {resultMessage.success ? (
              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            )}
            <span className={`text-sm font-medium ${
              resultMessage.success 
                ? "text-green-700 dark:text-green-300" 
                : "text-red-700 dark:text-red-300"
            }`}>
              {resultMessage.message}
            </span>
          </div>
          <button 
            onClick={() => setResultMessage(null)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <File className="h-16 w-16 mb-4 opacity-50" />
            <p>请选择一个文件夹来浏览文件</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        selectAll()
                      } else {
                        clearSelection()
                      }
                    }}
                  />
                </TableHead>
                <TableHead>文件名</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.path}>
                  <TableCell>
                    <Checkbox
                      checked={selectedFiles.has(file.path)}
                      onCheckedChange={() => toggleFileSelection(file.path)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{file.name}</TableCell>
                  <TableCell>{formatFileSize(file.size)}</TableCell>
                  <TableCell>
                    {file.is_encrypted ? (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <Lock className="h-3 w-3" />
                        已加密
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-green-600">
                        <Unlock className="h-3 w-3" />
                        未加密
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <PasswordDialog
        open={dialogMode === "encrypt"}
        onOpenChange={(open) => !open && setDialogMode(null)}
        onSubmit={handleEncrypt}
        title="加密文件"
        description="请输入加密密码，加密后文件将无法恢复（除非使用正确密码解密）"
      />

      <PasswordDialog
        open={dialogMode === "decrypt"}
        onOpenChange={(open) => !open && setDialogMode(null)}
        onSubmit={handleDecrypt}
        title="解密文件"
        description="请输入解密密码以恢复文件"
      />
    </div>
  )
}

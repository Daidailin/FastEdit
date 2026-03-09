const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 新的内存映射文件 API
    readFileLines: (startLine, endLine) => ipcRenderer.invoke('read-file-lines', { startLine, endLine }),
    readLine: (lineNumber) => ipcRenderer.invoke('read-line', lineNumber),
    getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
    offsetToLine: (offset) => ipcRenderer.invoke('offset-to-line', offset),

    // 文件保存 API
    saveFileContent: (filePath, content) => ipcRenderer.invoke('save-file-content', { filePath, content }),
    saveNewFile: (filePath, content) => ipcRenderer.invoke('save-new-file', { filePath, content }),

    // 编码相关 API
    detectFileEncoding: (filePath) => ipcRenderer.invoke('detect-file-encoding', filePath),
    setFileEncoding: (encoding) => ipcRenderer.invoke('set-file-encoding', encoding),
    getFileEncoding: () => ipcRenderer.invoke('get-file-encoding'),
    getSupportedEncodings: () => ipcRenderer.invoke('get-supported-encodings'),
    convertAndSaveFile: (filePath, content, encoding, addBOM) => ipcRenderer.invoke('convert-and-save-file', { filePath, content, encoding, addBOM }),

    // 文本比较 API
    openCompareWindow: (data) => ipcRenderer.invoke('open-compare-window', data),
    compareTexts: ({ original, compare }) => ipcRenderer.invoke('compare-texts', { original, compare }),
    closeCompareWindow: () => ipcRenderer.invoke('close-compare-window'),

    // 比较文件 API
    openCompareFile: () => ipcRenderer.invoke('open-compare-file'),
    readCompareFileLines: (startLine, endLine) => ipcRenderer.invoke('read-compare-file-lines', { startLine, endLine }),
    getCompareFileInfo: () => ipcRenderer.invoke('get-compare-file-info'),

    // 事件监听
    onFileOpened: (callback) => ipcRenderer.on('file-opened', (event, data) => callback(data)),
    onLoadingProgress: (callback) => ipcRenderer.on('loading-progress', (event, data) => callback(data)),
    onEncodingChanged: (callback) => ipcRenderer.on('encoding-changed', (event, data) => callback(data)),
    onCompareData: (callback) => ipcRenderer.on('compare-data', (event, data) => callback(data)),
    onSaveFile: (callback) => ipcRenderer.on('save-file', () => callback()),
    onSaveFileAs: (callback) => ipcRenderer.on('save-file-as', (event, filePath) => callback(filePath)),
    onUndo: (callback) => ipcRenderer.on('undo', () => callback()),
    onRedo: (callback) => ipcRenderer.on('redo', () => callback()),
    onCut: (callback) => ipcRenderer.on('cut', () => callback()),
    onCopy: (callback) => ipcRenderer.on('copy', () => callback()),
    onPaste: (callback) => ipcRenderer.on('paste', () => callback()),
    onZoomIn: (callback) => ipcRenderer.on('zoom-in', () => callback()),
    onZoomOut: (callback) => ipcRenderer.on('zoom-out', () => callback()),
    onZoomReset: (callback) => ipcRenderer.on('zoom-reset', () => callback())
});

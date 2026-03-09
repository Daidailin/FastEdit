const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { MemoryMappedFileManager } = require('./memory-map');
const { detectFileEncoding, SUPPORTED_ENCODINGS, stringToBuffer } = require('./encoding-detector');
const { TextComparer } = require('./text-compare');

let mainWindow;
let compareWindow = null;
let currentFilePath = null;
let fileManager = null;
let isOpeningFile = false;

// 保存原始的 console 函数
const originalLog = console.log;
const originalError = console.error;

// 创建日志文件
const logFilePath = path.join(app.getPath('userData'), 'fastedit-debug.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function writeLogToFile(level, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    // 使用 UTF-8 编码写入，避免中文乱码
    logStream.write(Buffer.from(logMessage, 'utf8'));
}

// 重定向 console.log
console.log = function(...args) {
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
    writeLogToFile('LOG', message);
    originalLog.apply(console, args);
};

// 重定向 console.error
console.error = function(...args) {
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
    writeLogToFile('ERROR', message);
    originalError.apply(console, args);
};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    
    // 自动打开开发者工具以便调试
    mainWindow.webContents.openDevTools();

    const menuTemplate = [
        {
            label: '文件',
            submenu: [
                {
                    label: '打开',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => openFile()
                },
                {
                    label: '保存',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => mainWindow.webContents.send('save-file')
                },
                {
                    label: '另存为',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => saveFileAs()
                },
                { type: 'separator' },
                {
                    label: '退出',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => app.quit()
                }
            ]
        },
        {
            label: '编辑',
            submenu: [
                {
                    label: '撤销',
                    accelerator: 'CmdOrCtrl+Z',
                    click: () => mainWindow.webContents.send('undo')
                },
                {
                    label: '重做',
                    accelerator: 'CmdOrCtrl+Y',
                    click: () => mainWindow.webContents.send('redo')
                },
                { type: 'separator' },
                {
                    label: '剪切',
                    accelerator: 'CmdOrCtrl+X',
                    click: () => mainWindow.webContents.send('cut')
                },
                {
                    label: '复制',
                    accelerator: 'CmdOrCtrl+C',
                    click: () => mainWindow.webContents.send('copy')
                },
                {
                    label: '粘贴',
                    accelerator: 'CmdOrCtrl+V',
                    click: () => mainWindow.webContents.send('paste')
                }
            ]
        },
        {
            label: '视图',
            submenu: [
                {
                    label: '放大',
                    accelerator: 'CmdOrCtrl+Plus',
                    click: () => mainWindow.webContents.send('zoom-in')
                },
                {
                    label: '缩小',
                    accelerator: 'CmdOrCtrl+-',
                    click: () => mainWindow.webContents.send('zoom-out')
                },
                {
                    label: '重置缩放',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => mainWindow.webContents.send('zoom-reset')
                },
                { type: 'separator' },
                {
                    label: '开发者工具',
                    accelerator: 'F12',
                    click: () => mainWindow.webContents.toggleDevTools()
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

async function openFile() {
    // 防止重复打开文件
    if (isOpeningFile) {
        console.log('文件正在打开中，忽略重复请求');
        return;
    }
    
    isOpeningFile = true;
    
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [
                { name: '文本文件', extensions: ['txt', 'log', 'json', 'xml', 'html', 'css', 'js', 'md'] },
                { name: '所有文件', extensions: ['*'] }
            ]
        });

        if (result.canceled || result.filePaths.length === 0) {
            isOpeningFile = false;
            return;
        }
        
        const filePath = result.filePaths[0];
        currentFilePath = filePath;
        
        try {
            if (fileManager) {
                fileManager.close();
            }
            
            fileManager = new MemoryMappedFileManager();
            
            mainWindow.webContents.send('loading-progress', {
                message: '正在检测文件编码...',
                percent: 0
            });
            
            // 检测文件编码
            const encodingResult = await detectFileEncoding(filePath);
            console.log('Detected encoding:', encodingResult);
            
            // 设置文件编码
            fileManager.setEncoding(encodingResult.encoding);
            
            mainWindow.webContents.send('loading-progress', {
                message: '正在使用内存映射打开文件...',
                percent: 10
            });
            
            const openResult = await fileManager.openFile(filePath, (percent, current, total) => {
                mainWindow.webContents.send('loading-progress', {
                    message: `正在构建行索引 (${current}/${total})...`,
                    percent: 10 + Math.round(percent * 0.9)
                });
            });
            
            mainWindow.setTitle(`${path.basename(filePath)} - FastEdit`);
            
            console.log('Sending file-opened event:', openResult);
            
            // 发送文件打开事件
            const fileData = {
                filePath: filePath,
                fileSize: openResult.fileSize,
                totalLines: openResult.totalLines,
                fileName: path.basename(filePath),
                encoding: encodingResult.encoding,
                confidence: encodingResult.confidence,
                hasBOM: encodingResult.hasBOM || false
            };
            
            // 如果页面正在加载，等待加载完成后再发送
            if (mainWindow.webContents.isLoading()) {
                mainWindow.webContents.once('did-finish-load', () => {
                    console.log('Page finished loading, sending file-opened event');
                    mainWindow.webContents.send('file-opened', fileData);
                    isOpeningFile = false;
                });
            } else {
                // 页面已经加载完成，直接发送
                mainWindow.webContents.send('file-opened', fileData);
                isOpeningFile = false;
            }
        } catch (error) {
            console.error('打开文件失败:', error);
            dialog.showErrorBox('打开文件失败', error.message);
            if (fileManager) {
                fileManager.close();
                fileManager = null;
            }
            isOpeningFile = false;
        }
    } catch (error) {
        console.error('选择文件对话框出错:', error);
        isOpeningFile = false;
    }
}

async function saveFileAs() {
    const result = await dialog.showSaveDialog(mainWindow, {
        filters: [
            { name: '文本文件', extensions: ['txt'] },
            { name: '所有文件', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        currentFilePath = result.filePath;
        mainWindow.webContents.send('save-file-as', result.filePath);
    }
}

// IPC 请求队列和限流控制
const readRequestQueue = [];
let isProcessingQueue = false;
const MAX_CONCURRENT_REQUESTS = 3; // 减少并发数
const MAX_QUEUE_SIZE = 500; // 增加队列容量
let activeRequests = 0;
let processedCount = 0;
let lastLogTime = 0;

/**
 * 处理读取请求队列
 */
async function processReadQueue() {
    if (isProcessingQueue || readRequestQueue.length === 0 || activeRequests >= MAX_CONCURRENT_REQUESTS) {
        return;
    }

    isProcessingQueue = true;

    try {
        // 如果队列超过最大限制，丢弃中间过时的请求，保留最新的
        if (readRequestQueue.length > MAX_QUEUE_SIZE) {
            const now = Date.now();
            // 每5秒只记录一次日志，避免日志刷屏
            if (now - lastLogTime > 5000) {
                console.warn(`请求队列超过限制 (${MAX_QUEUE_SIZE})，丢弃过时请求，当前队列: ${readRequestQueue.length}`);
                lastLogTime = now;
            }
            // 保留最新的100个请求
            const preservedRequests = readRequestQueue.slice(-100);
            // 拒绝被丢弃的请求
            readRequestQueue.slice(0, -100).forEach(req => {
                req.reject(new Error('请求被丢弃，请重试'));
            });
            readRequestQueue.length = 0;
            readRequestQueue.push(...preservedRequests);
        }

        // 处理请求
        while (readRequestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
            const request = readRequestQueue.shift();
            activeRequests++;
            processedCount++;

            // 直接处理，不使用 setImmediate 避免递归过深
            try {
                const lines = fileManager.readLines(request.startLine, request.endLine);
                request.resolve(lines);
            } catch (error) {
                console.error('读取行失败:', error);
                request.reject(error);
            } finally {
                activeRequests--;
            }
        }
    } finally {
        isProcessingQueue = false;
        // 如果还有请求，继续处理
        if (readRequestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
            setImmediate(processReadQueue);
        }
    }
}

ipcMain.handle('read-file-lines', async (event, { startLine, endLine }) => {
    return new Promise((resolve, reject) => {
        if (!fileManager) {
            reject(new Error('文件未打开'));
            return;
        }

        // 将请求加入队列
        readRequestQueue.push({ startLine, endLine, resolve, reject });

        // 触发队列处理
        processReadQueue();
    });
});

ipcMain.handle('read-line', async (event, lineNumber) => {
    try {
        if (!fileManager) {
            throw new Error('文件未打开');
        }
        
        const content = fileManager.readLine(lineNumber);
        return { lineNum: lineNumber, content: content };
    } catch (error) {
        console.error(`读取第 ${lineNumber} 行失败:`, error);
        throw error;
    }
});

ipcMain.handle('get-file-info', async (event, filePath) => {
    try {
        if (fileManager && fileManager.fileSize > 0) {
            return {
                size: fileManager.fileSize,
                totalLines: fileManager.getLineCount(),
                isFile: true
            };
        }
        
        return new Promise((resolve, reject) => {
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        size: stats.size,
                        isFile: stats.isFile()
                    });
                }
            });
        });
    } catch (error) {
        throw error;
    }
});

ipcMain.handle('offset-to-line', async (event, offset) => {
    try {
        if (!fileManager) {
            throw new Error('文件未打开');
        }
        
        const lineNumber = fileManager.offsetToLine(offset);
        return { lineNumber };
    } catch (error) {
        console.error('偏移量转换失败:', error);
        throw error;
    }
});

ipcMain.handle('save-file-content', async (event, { filePath, content }) => {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, content, 'utf-8', (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(true);
            }
        });
    });
});

ipcMain.handle('save-new-file', async (event, { filePath, content }) => {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, content, 'utf-8', (err) => {
            if (err) {
                reject(err);
            } else {
                currentFilePath = filePath;
                mainWindow.setTitle(`${path.basename(filePath)} - FastEdit`);
                resolve(true);
            }
        });
    });
});

// 编码相关 IPC 处理
ipcMain.handle('detect-file-encoding', async (event, filePath) => {
    try {
        const result = await detectFileEncoding(filePath);
        return result;
    } catch (error) {
        console.error('检测编码失败:', error);
        return { encoding: 'UTF-8', confidence: 0 };
    }
});

ipcMain.handle('set-file-encoding', async (event, encoding) => {
    try {
        if (!fileManager) {
            throw new Error('文件未打开');
        }
        fileManager.setEncoding(encoding);
        
        // 通知渲染进程编码已改变
        mainWindow.webContents.send('encoding-changed', {
            encoding: encoding,
            confidence: 1
        });
        
        return { success: true, encoding };
    } catch (error) {
        console.error('设置编码失败:', error);
        throw error;
    }
});

ipcMain.handle('get-file-encoding', async () => {
    try {
        if (!fileManager) {
            return { encoding: 'UTF-8' };
        }
        return { encoding: fileManager.getEncoding() };
    } catch (error) {
        console.error('获取编码失败:', error);
        return { encoding: 'UTF-8' };
    }
});

ipcMain.handle('get-supported-encodings', async () => {
    return SUPPORTED_ENCODINGS;
});

ipcMain.handle('convert-and-save-file', async (event, { filePath, content, encoding, addBOM }) => {
    try {
        const buffer = stringToBuffer(content, encoding, addBOM);
        await fs.promises.writeFile(filePath, buffer);
        
        // 更新当前文件路径和编码
        currentFilePath = filePath;
        if (fileManager) {
            fileManager.setEncoding(encoding);
        }
        
        mainWindow.setTitle(`${path.basename(filePath)} - FastEdit`);
        
        return { success: true };
    } catch (error) {
        console.error('保存文件失败:', error);
        throw error;
    }
});

// 文本比较功能 IPC
ipcMain.handle('open-compare-window', async (event, data = {}) => {
    try {
        // 如果比较窗口已存在，则聚焦
        if (compareWindow && !compareWindow.isDestroyed()) {
            compareWindow.focus();
            
            // 如果有数据，发送给比较窗口
            if (data.original || data.compare) {
                compareWindow.webContents.send('compare-data', data);
            }
            
            return { success: true };
        }
        
        // 创建新的比较窗口
        compareWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            minWidth: 800,
            minHeight: 600,
            parent: mainWindow,
            backgroundColor: '#1e1e1e',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            }
        });
        
        await compareWindow.loadFile(path.join(__dirname, '../renderer/compare.html'));
        
        // 如果有数据，发送给比较窗口
        if (data.original || data.compare) {
            compareWindow.webContents.send('compare-data', data);
        }
        
        compareWindow.on('closed', () => {
            compareWindow = null;
        });
        
        return { success: true };
    } catch (error) {
        console.error('打开比较窗口失败:', error);
        throw error;
    }
});

ipcMain.handle('compare-texts', async (event, { original, compare }) => {
    try {
        const comparer = new TextComparer();
        comparer.setOriginal(original);
        comparer.setCompare(compare);

        const result = comparer.computeDiff();

        return {
            similarity: result.similarity,
            diffLines: result.diffLines,
            diffMap: Object.fromEntries(result.diffMap),
            mode: result.mode,
            originalLines: result.originalLines,
            compareLines: result.compareLines
        };
    } catch (error) {
        console.error('文本比较失败:', error);
        throw error;
    }
});

ipcMain.handle('close-compare-window', async () => {
    if (compareWindow && !compareWindow.isDestroyed()) {
        compareWindow.close();
        compareWindow = null;
    }
    return { success: true };
});

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

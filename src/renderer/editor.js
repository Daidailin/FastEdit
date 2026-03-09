import { VirtualScrollList } from './virtual-scroll.js';
import { LineNumberWidthManager } from './line-number-width.js';

class LargeFileEditor {
    constructor() {
        this.filePath = null;
        this.fileSize = 0;
        this.totalLines = 0;

        this.lineHeight = 24;
        this.fontSize = 16;

        this.currentLine = 1;
        this.currentCol = 1;

        this.undoStack = [];
        this.redoStack = [];
        this.maxUndoSteps = 100;

        this.isLoading = false;
        this.scrollTimeout = null;

        // 缓存行数据
        this.lineCache = new Map();
        this.maxCacheSize = 100;

        // 编码相关
        this.currentEncoding = 'UTF-8';
        this.supportedEncodings = [];

        // 初始化行号宽度管理器
        this.lineNumberWidthManager = new LineNumberWidthManager({
            minWidth: 40,
            padding: 20,
            extraDigits: 1
        });

        this.initElements();
        this.initEventListeners();
        this.initIPC();

        // 设置初始字体
        this.updateLineNumberFont();

        // 加载支持的编码列表
        this.loadSupportedEncodings();
    }

    initElements() {
        this.lineNumbersEl = document.getElementById('line-numbers');
        this.editorScrollEl = document.getElementById('editor-scroll');
        this.editorContentEl = document.getElementById('editor-content');
        this.cursorEl = document.getElementById('cursor');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.loadingProgressBar = document.getElementById('loading-progress-bar');
        this.loadingText = document.getElementById('loading-text');
        this.welcomeScreen = document.getElementById('welcome-screen');

        this.statusFile = document.getElementById('status-file');
        this.statusSize = document.getElementById('status-size');
        this.statusPosition = document.getElementById('status-position');
        this.statusLines = document.getElementById('status-lines');
    }

    initEventListeners() {
        this.editorScrollEl.addEventListener('scroll', () => this.onScroll());
        this.editorContentEl.addEventListener('click', (e) => this.onEditorClick(e));
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('resize', () => this.onResize());

        // 工具栏按钮事件
        this.initToolbarButtons();
    }

    /**
     * 初始化工具栏按钮
     */
    initToolbarButtons() {
        // 文本比较按钮
        const btnCompare = document.getElementById('btn-compare');
        if (btnCompare) {
            btnCompare.addEventListener('click', () => this.openCompareWindow());
        }

        // 打开文件按钮
        const btnOpen = document.getElementById('btn-open');
        if (btnOpen) {
            btnOpen.addEventListener('click', () => {
                // 触发菜单的打开文件功能
                if (window.electronAPI) {
                    // 通过 IPC 通知主进程打开文件
                    window.electronAPI.openFile && window.electronAPI.openFile();
                }
            });
        }

        // 保存按钮
        const btnSave = document.getElementById('btn-save');
        if (btnSave) {
            btnSave.addEventListener('click', () => this.saveFile());
        }

        // 缩放按钮
        const btnZoomIn = document.getElementById('btn-zoom-in');
        if (btnZoomIn) {
            btnZoomIn.addEventListener('click', () => this.zoomIn());
        }

        const btnZoomOut = document.getElementById('btn-zoom-out');
        if (btnZoomOut) {
            btnZoomOut.addEventListener('click', () => this.zoomOut());
        }
    }

    /**
     * 打开文本比较窗口
     */
    async openCompareWindow() {
        try {
            // 获取当前文档内容作为原始文档
            const originalText = await this.getCurrentDocumentText();

            await window.electronAPI.openCompareWindow({
                original: originalText,
                compare: ''
            });
        } catch (error) {
            console.error('打开比较窗口失败:', error);
            alert('打开比较窗口失败: ' + error.message);
        }
    }

    /**
     * 获取当前文档文本内容
     * 优化：分批读取避免大文件卡顿
     */
    async getCurrentDocumentText() {
        if (!this.contentVirtualList || this.totalLines === 0) {
            return '';
        }

        // 对于大文件，限制读取行数，避免卡顿
        const MAX_LINES = 10000;
        const linesToRead = Math.min(this.totalLines, MAX_LINES);

        if (this.totalLines > MAX_LINES) {
            console.warn(`文件过大，只读取前 ${MAX_LINES} 行进行比较`);
        }

        // 分批读取，每批 100 行
        const BATCH_SIZE = 100;
        const lines = [];

        for (let batchStart = 1; batchStart <= linesToRead; batchStart += BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, linesToRead);

            try {
                const batchLines = await window.electronAPI.readFileLines(batchStart, batchEnd);
                for (const line of batchLines) {
                    lines.push(line.content);
                }
            } catch (error) {
                console.error(`读取第 ${batchStart}-${batchEnd} 行失败:`, error);
                // 填充空行
                for (let i = batchStart; i <= batchEnd; i++) {
                    lines.push('');
                }
            }

            // 每批读取后让出时间片，避免阻塞 UI
            if (batchStart + BATCH_SIZE <= linesToRead) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return lines.join('\n');
    }

    initIPC() {
        window.electronAPI.onFileOpened((data) => this.onFileOpened(data));
        window.electronAPI.onLoadingProgress((data) => this.showLoading(data.message, data.percent));
        window.electronAPI.onEncodingChanged((data) => this.onEncodingChanged(data));

        window.electronAPI.onSaveFile(() => this.saveFile());
        window.electronAPI.onSaveFileAs((filePath) => this.saveFileAs(filePath));

        window.electronAPI.onUndo(() => this.undo());
        window.electronAPI.onRedo(() => this.redo());
        window.electronAPI.onCut(() => this.cut());
        window.electronAPI.onCopy(() => this.copy());
        window.electronAPI.onPaste(() => this.paste());

        window.electronAPI.onZoomIn(() => this.zoomIn());
        window.electronAPI.onZoomOut(() => this.zoomOut());
        window.electronAPI.onZoomReset(() => this.zoomReset());
    }

    /**
     * 加载支持的编码列表
     */
    async loadSupportedEncodings() {
        try {
            this.supportedEncodings = await window.electronAPI.getSupportedEncodings();
        } catch (error) {
            console.error('加载编码列表失败:', error);
            // 使用默认编码列表
            this.supportedEncodings = [
                { name: 'UTF-8', label: 'UTF-8' },
                { name: 'GBK', label: 'GBK' },
                { name: 'GB2312', label: 'GB2312' },
                { name: 'GB18030', label: 'GB18030' }
            ];
        }
    }

    /**
     * 处理编码改变事件
     */
    onEncodingChanged(data) {
        console.log('编码已改变:', data);
        this.currentEncoding = data.encoding;

        // 清空缓存
        this.lineCache.clear();

        // 刷新虚拟滚动列表，强制重新渲染所有可见行
        if (this.contentVirtualList) {
            this.contentVirtualList.refresh();
        }
        if (this.lineNumberVirtualList) {
            this.lineNumberVirtualList.refresh();
        }

        // 更新状态栏
        this.updateStatusBarEncoding();
    }

    /**
     * 设置文件编码
     */
    async setEncoding(encoding) {
        try {
            await window.electronAPI.setFileEncoding(encoding);
            // 编码改变后会通过 onEncodingChanged 事件通知
        } catch (error) {
            console.error('设置编码失败:', error);
            alert('设置编码失败: ' + error.message);
        }
    }

    /**
     * 获取当前编码
     */
    getEncoding() {
        return this.currentEncoding;
    }

    /**
     * 更新行号字体设置
     */
    updateLineNumberFont() {
        const font = `${this.fontSize}px Consolas, "Courier New", monospace`;
        this.lineNumberWidthManager.setFont(font);
    }

    /**
     * 更新行号容器宽度
     * @returns {boolean} 是否更新了宽度
     */
    updateLineNumberWidth() {
        const result = this.lineNumberWidthManager.update(this.totalLines);

        if (result) {
            const { newWidth } = result;

            // 更新行号容器宽度
            this.lineNumbersEl.style.width = `${newWidth}px`;

            // 更新编辑器内容区域的左边距
            this.editorContentEl.style.marginLeft = '0';

            // 触发重绘以确保布局正确
            this.lineNumbersEl.offsetHeight;

            return true;
        }

        return false;
    }

    /**
     * 强制更新行号容器宽度（用于初始化或字体变化时）
     * @param {number} visibleMaxLineNum - 可视区域最大行号，默认为总文件行数
     */
    forceUpdateLineNumberWidth(visibleMaxLineNum = null) {
        const maxLine = visibleMaxLineNum || this.totalLines;
        const { newWidth } = this.lineNumberWidthManager.forceUpdate(maxLine);

        // 更新行号容器宽度
        this.lineNumbersEl.style.width = `${newWidth}px`;

        // 触发重绘
        this.lineNumbersEl.offsetHeight;
    }

    async onFileOpened(data) {
        console.log('onFileOpened called:', data);
        this.isLoading = true;
        this.filePath = data.filePath;
        this.fileSize = data.fileSize;
        this.totalLines = data.totalLines;

        // 设置编码信息
        if (data.encoding) {
            this.currentEncoding = data.encoding;
            console.log(`文件编码: ${data.encoding} (置信度: ${(data.confidence * 100).toFixed(1)}%)`);
            if (data.hasBOM) {
                console.log('文件包含 BOM');
            }
        }

        this.welcomeScreen.classList.add('hidden');

        try {
            this.updateStatusBar(data.fileName);
            this.updateStatusBarEncoding();

            // 清空缓存
            this.lineCache.clear();

            // 计算初始可视区域的行数
            const viewportHeight = this.editorScrollEl.clientHeight || 600;
            const visibleLines = Math.ceil(viewportHeight / this.lineHeight);
            const initialVisibleMaxLine = Math.min(this.totalLines, visibleLines);

            // 强制更新行号宽度（基于初始可视区域）
            this.forceUpdateLineNumberWidth(initialVisibleMaxLine);

            // 销毁旧的虚拟滚动实例
            if (this.contentVirtualList) {
                this.contentVirtualList.destroy();
                this.contentVirtualList = null;
            }
            if (this.lineNumberVirtualList) {
                this.lineNumberVirtualList.destroy();
                this.lineNumberVirtualList = null;
            }

            // 获取容器高度
            const editorHeight = this.editorScrollEl.clientHeight || 600;
            const lineNumbersHeight = this.lineNumbersEl.clientHeight || 600;

            // 初始化内容虚拟滚动列表
            this.contentVirtualList = new VirtualScrollList({
                container: this.editorScrollEl,
                itemHeight: this.lineHeight,
                totalItems: this.totalLines,
                bufferSize: 5,
                containerHeight: editorHeight,
                renderItem: (index) => this.renderContentLine(index + 1)
            });

            // 初始化行号虚拟滚动列表
            this.lineNumberVirtualList = new VirtualScrollList({
                container: this.lineNumbersEl,
                itemHeight: this.lineHeight,
                totalItems: this.totalLines,
                bufferSize: 5,
                containerHeight: lineNumbersHeight,
                renderItem: (index) => this.renderLineNumber(index + 1)
            });

            // 同步两个列表的滚动
            this.syncScroll();

            this.updateCursorPosition(1, 1);

            this.hideLoading();
            this.isLoading = false;
            
            console.log('文件加载完成，虚拟滚动初始化成功');
        } catch (error) {
            console.error('加载文件失败:', error);
            this.hideLoading();
            this.isLoading = false;
            alert('加载文件失败: ' + error.message);
        }
    }

    /**
     * 渲染内容行占位符（不读取文件）
     */
    renderContentLinePlaceholder(lineNum) {
        const lineEl = document.createElement('div');
        lineEl.className = 'line';
        lineEl.dataset.line = lineNum;
        lineEl.textContent = ' '; // 空白内容
        return lineEl;
    }

    renderContentLine(lineNum) {
        const lineEl = document.createElement('div');
        lineEl.className = 'line';
        lineEl.dataset.line = lineNum;
        lineEl.textContent = ' '; // 先显示空白

        // 异步加载行内容
        this.loadLineContent(lineNum).then(content => {
            if (lineEl.isConnected) { // 确保元素仍在DOM中
                lineEl.textContent = content || ' ';
            }
        }).catch(error => {
            if (lineEl.isConnected) {
                lineEl.textContent = ' ';
                lineEl.style.color = '#ff6b6b';
            }
        });

        return lineEl;
    }

    renderLineNumber(lineNum) {
        const numEl = document.createElement('div');
        numEl.className = 'line';
        numEl.textContent = lineNum;
        numEl.style.textAlign = 'right';
        numEl.style.overflow = 'hidden';
        numEl.style.whiteSpace = 'nowrap';
        return numEl;
    }

    async loadLineContent(lineNum) {
        // 检查缓存
        if (this.lineCache.has(lineNum)) {
            return this.lineCache.get(lineNum);
        }

        try {
            // 批量读取：读取请求行及其周围行（预读优化）
            const PRELOAD_RANGE = 10; // 预读前后10行
            const startLine = Math.max(1, lineNum - PRELOAD_RANGE);
            const endLine = Math.min(this.totalLines, lineNum + PRELOAD_RANGE);

            const result = await window.electronAPI.readFileLines(startLine, endLine);

            // 缓存所有读取的行
            for (let i = 0; i < result.length; i++) {
                const actualLineNum = startLine + i;
                const content = result[i]?.content || '';
                this.addToLineCache(actualLineNum, content);
            }

            return this.lineCache.get(lineNum) || '';
        } catch (error) {
            // 如果是请求被丢弃，稍后重试
            if (error.message && error.message.includes('请求被丢弃')) {
                console.warn(`第 ${lineNum} 行请求被丢弃，稍后重试`);
                // 延迟200ms后重试
                await new Promise(resolve => setTimeout(resolve, 200));
                return this.loadLineContent(lineNum);
            }
            console.error(`读取第 ${lineNum} 行失败:`, error);
            return '';
        }
    }

    addToLineCache(lineNum, content) {
        if (this.lineCache.size >= this.maxCacheSize) {
            const firstKey = this.lineCache.keys().next().value;
            this.lineCache.delete(firstKey);
        }
        this.lineCache.set(lineNum, content);
    }

    onScroll() {
        if (this.isLoading || !this.contentVirtualList) return;

        // 防抖处理
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
        }

        this.scrollTimeout = setTimeout(() => {
            this.syncScroll();
        }, 8); // 约 120fps
    }

    syncScroll() {
        if (!this.contentVirtualList || !this.lineNumberVirtualList) return;

        const scrollTop = this.editorScrollEl.scrollTop;
        const viewportHeight = this.editorScrollEl.clientHeight;

        // 计算可视区域的行号范围
        const visibleStartLine = Math.floor(scrollTop / this.lineHeight) + 1;
        const visibleEndLine = Math.min(
            this.totalLines,
            Math.ceil((scrollTop + viewportHeight) / this.lineHeight)
        );

        // 更新行号宽度（基于可视区域的最大行号）
        this.updateVisibleLineNumberWidth(visibleEndLine);

        // 同步行号列表的滚动位置
        this.lineNumbersEl.scrollTop = scrollTop;

        // 更新当前行号
        this.currentLine = visibleStartLine;
        this.updateCursorPosition(this.currentLine, this.currentCol);
    }

    /**
     * 根据可视区域的最大行号更新行号容器宽度
     * @param {number} visibleMaxLineNum - 可视区域最大行号
     */
    updateVisibleLineNumberWidth(visibleMaxLineNum) {
        const result = this.lineNumberWidthManager.update(visibleMaxLineNum);

        if (result) {
            const { newWidth } = result;

            // 更新行号容器宽度
            this.lineNumbersEl.style.width = `${newWidth}px`;

            // 触发重绘以确保布局正确
            this.lineNumbersEl.offsetHeight;
        }
    }

    onEditorClick(e) {
        const rect = this.editorContentEl.getBoundingClientRect();
        const scrollTop = this.editorScrollEl.scrollTop;

        const clickY = e.clientY - rect.top + scrollTop;
        const line = Math.floor(clickY / this.lineHeight) + 1;

        const clickedLineEl = e.target.closest('.line');
        if (clickedLineEl) {
            const lineContent = clickedLineEl.textContent;
            const charWidth = this.measureCharWidth();

            const clickX = e.clientX - rect.left;
            let col = Math.floor(clickX / charWidth) + 1;
            col = Math.max(1, Math.min(col, lineContent.length + 1));

            this.currentLine = line;
            this.currentCol = col;
            this.updateCursorPosition(line, col);
        }
    }

    onKeyDown(e) {
        if (this.isLoading) return;

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                this.moveCursorUp();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.moveCursorDown();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.moveCursorLeft();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.moveCursorRight();
                break;
            case 'Home':
                e.preventDefault();
                this.currentCol = 1;
                this.updateCursorPosition(this.currentLine, this.currentCol);
                break;
            case 'End':
                e.preventDefault();
                this.moveCursorToEnd();
                break;
            case 'PageUp':
                e.preventDefault();
                this.moveCursorPageUp();
                break;
            case 'PageDown':
                e.preventDefault();
                this.moveCursorPageDown();
                break;
        }
    }

    moveCursorUp() {
        if (this.currentLine > 1) {
            this.currentLine--;
            this.ensureLineInView();
            this.updateCursorPosition(this.currentLine, this.currentCol);
        }
    }

    moveCursorDown() {
        if (this.currentLine < this.totalLines) {
            this.currentLine++;
            this.ensureLineInView();
            this.updateCursorPosition(this.currentLine, this.currentCol);
        }
    }

    moveCursorLeft() {
        if (this.currentCol > 1) {
            this.currentCol--;
            this.updateCursorPosition(this.currentLine, this.currentCol);
        } else if (this.currentLine > 1) {
            this.currentLine--;
            this.moveCursorToEnd();
        }
    }

    moveCursorRight() {
        this.currentCol++;
        this.updateCursorPosition(this.currentLine, this.currentCol);
    }

    moveCursorToEnd() {
        const lineEl = this.contentVirtualList?.getItemElement(this.currentLine - 1);
        const lineContent = lineEl ? lineEl.textContent : '';
        this.currentCol = lineContent.length + 1;
        this.updateCursorPosition(this.currentLine, this.currentCol);
    }

    moveCursorPageUp() {
        const pageLines = Math.floor(this.editorScrollEl.clientHeight / this.lineHeight);
        this.currentLine = Math.max(1, this.currentLine - pageLines);
        this.ensureLineInView();
        this.updateCursorPosition(this.currentLine, this.currentCol);
    }

    moveCursorPageDown() {
        const pageLines = Math.floor(this.editorScrollEl.clientHeight / this.lineHeight);
        this.currentLine = Math.min(this.totalLines, this.currentLine + pageLines);
        this.ensureLineInView();
        this.updateCursorPosition(this.currentLine, this.currentCol);
    }

    ensureLineInView() {
        const cursorY = (this.currentLine - 1) * this.lineHeight;
        const scrollTop = this.editorScrollEl.scrollTop;
        const viewportHeight = this.editorScrollEl.clientHeight;

        if (cursorY < scrollTop) {
            this.editorScrollEl.scrollTop = cursorY;
        } else if (cursorY > scrollTop + viewportHeight - this.lineHeight) {
            this.editorScrollEl.scrollTop = cursorY - viewportHeight + this.lineHeight;
        }
    }

    updateCursorPosition(line, col) {
        this.currentLine = line;
        this.currentCol = col;

        const charWidth = this.measureCharWidth();
        const x = (col - 1) * charWidth;
        const y = (line - 1) * this.lineHeight;

        this.cursorEl.style.display = 'block';
        this.cursorEl.style.left = x + 'px';
        this.cursorEl.style.top = (y - this.editorScrollEl.scrollTop + 3) + 'px';

        this.updateStatusPosition();
    }

    measureCharWidth() {
        const testEl = document.createElement('span');
        testEl.textContent = 'M';
        testEl.style.fontFamily = 'Consolas, "Courier New", monospace';
        testEl.style.fontSize = this.fontSize + 'px';
        testEl.style.visibility = 'hidden';
        testEl.style.position = 'absolute';
        document.body.appendChild(testEl);
        const width = testEl.offsetWidth;
        document.body.removeChild(testEl);
        return width;
    }

    updateStatusBar(fileName) {
        this.statusFile.textContent = fileName || '未打开文件';
        this.statusSize.textContent = this.formatFileSize(this.fileSize);
        this.statusLines.textContent = `行数: ${this.totalLines.toLocaleString()}`;
    }

    /**
     * 更新状态栏编码显示
     */
    updateStatusBarEncoding() {
        // 查找或创建编码显示元素
        let encodingEl = document.getElementById('status-encoding');
        if (!encodingEl) {
            encodingEl = document.createElement('span');
            encodingEl.id = 'status-encoding';
            // 插入到状态栏
            const statusBar = document.getElementById('status-bar');
            const rightSection = statusBar.querySelector('div:last-child');
            rightSection.insertBefore(encodingEl, rightSection.firstChild);
        }
        encodingEl.textContent = this.currentEncoding;
        encodingEl.style.marginRight = '20px';
        encodingEl.style.cursor = 'pointer';
        encodingEl.title = '点击更改编码';
        encodingEl.onclick = () => this.showEncodingSelector();
    }

    /**
     * 显示编码选择器
     */
    showEncodingSelector() {
        // 创建编码选择对话框
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #252526;
            border: 1px solid #3c3c3c;
            border-radius: 4px;
            padding: 20px;
            z-index: 2000;
            min-width: 300px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        `;

        const title = document.createElement('h3');
        title.textContent = '选择编码';
        title.style.cssText = 'color: #d4d4d4; margin-bottom: 15px; font-size: 16px;';
        dialog.appendChild(title);

        const select = document.createElement('select');
        select.style.cssText = `
            width: 100%;
            padding: 8px;
            background: #3c3c3c;
            color: #d4d4d4;
            border: 1px solid #555;
            border-radius: 3px;
            font-size: 14px;
            margin-bottom: 15px;
        `;

        this.supportedEncodings.forEach(enc => {
            const option = document.createElement('option');
            option.value = enc.name;
            option.textContent = enc.label;
            if (enc.name === this.currentEncoding) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        dialog.appendChild(select);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.style.cssText = `
            padding: 6px 16px;
            background: #3c3c3c;
            color: #d4d4d4;
            border: 1px solid #555;
            border-radius: 3px;
            cursor: pointer;
        `;
        cancelBtn.onclick = () => {
            document.body.removeChild(dialog);
            document.body.removeChild(overlay);
        };

        const okBtn = document.createElement('button');
        okBtn.textContent = '确定';
        okBtn.style.cssText = `
            padding: 6px 16px;
            background: #0e639c;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        okBtn.onclick = async () => {
            const newEncoding = select.value;
            if (newEncoding !== this.currentEncoding) {
                await this.setEncoding(newEncoding);
            }
            document.body.removeChild(dialog);
            document.body.removeChild(overlay);
        };

        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(okBtn);
        dialog.appendChild(buttonContainer);

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 1999;
        `;
        overlay.onclick = () => {
            document.body.removeChild(dialog);
            document.body.removeChild(overlay);
        };

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);
    }

    updateStatusPosition() {
        this.statusPosition.textContent = `行 ${this.currentLine.toLocaleString()}, 列 ${this.currentCol}`;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showLoading(message, percent = 0) {
        this.loadingOverlay.classList.remove('hidden');
        this.loadingText.textContent = message;
        this.loadingProgressBar.style.width = percent + '%';
    }

    hideLoading() {
        this.loadingOverlay.classList.add('hidden');
    }

    onResize() {
        if (this.contentVirtualList) {
            this.syncScroll();
        }
    }

    // 编辑功能（待实现）
    undo() {
        if (this.undoStack.length === 0) return;
        const state = this.undoStack.pop();
        this.redoStack.push(state);
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const state = this.redoStack.pop();
        this.undoStack.push(state);
    }

    cut() {
        // 待实现
    }

    copy() {
        // 待实现
    }

    paste() {
        // 待实现
    }

    saveFile() {
        // 待实现
    }

    saveFileAs(filePath) {
        // 待实现
    }

    // 缩放功能
    zoomIn() {
        this.fontSize = Math.min(32, this.fontSize + 2);
        this.applyZoom();
    }

    zoomOut() {
        this.fontSize = Math.max(10, this.fontSize - 2);
        this.applyZoom();
    }

    zoomReset() {
        this.fontSize = 16;
        this.applyZoom();
    }

    applyZoom() {
        document.documentElement.style.fontSize = this.fontSize + 'px';
        this.lineHeight = Math.round(this.fontSize * 1.5);

        // 更新行号字体并重新计算宽度（基于当前可视区域）
        this.updateLineNumberFont();
        if (this.totalLines > 0) {
            const scrollTop = this.editorScrollEl.scrollTop;
            const viewportHeight = this.editorScrollEl.clientHeight;
            const visibleEndLine = Math.min(
                this.totalLines,
                Math.ceil((scrollTop + viewportHeight) / this.lineHeight)
            );
            this.forceUpdateLineNumberWidth(visibleEndLine);
        }

        // 更新虚拟列表的行高
        if (this.contentVirtualList) {
            this.contentVirtualList.itemHeight = this.lineHeight;
            this.lineNumberVirtualList.itemHeight = this.lineHeight;
            this.syncScroll();
        }
    }
}

// 初始化编辑器
document.addEventListener('DOMContentLoaded', () => {
    window.editor = new LargeFileEditor();
});

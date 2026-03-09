/**
 * 文本比较界面渲染器
 * 处理比较界面的交互和显示
 * 使用虚拟滚动优化大文件性能
 */

import { CompareEditor } from './compare-virtual-scroll.js';

class CompareRenderer {
    constructor() {
        this.originalText = '';
        this.compareText = '';
        this.diffLines = [];
        this.currentDiffIndex = -1;
        this.isComparing = false;
        this.originalEditor = null;
        this.compareEditor = null;

        // 文件型数据源支持
        this.originalFileInfo = null; // 原始文档文件信息
        this.compareFileInfo = null; // 比较文档文件信息

        this.initElements();
        this.initEditors();
        this.initEventListeners();
        this.initIPC();
    }

    initElements() {
        // 按钮元素
        this.btnLoadOriginal = document.getElementById('btn-load-original');
        this.btnPasteOriginal = document.getElementById('btn-paste-original');
        this.btnLoadCompare = document.getElementById('btn-load-compare');
        this.btnPasteCompare = document.getElementById('btn-paste-compare');
        this.btnCompare = document.getElementById('btn-compare');
        this.btnClear = document.getElementById('btn-clear');
        this.btnClose = document.getElementById('btn-close');
        this.btnPrevDiff = document.getElementById('btn-prev-diff');
        this.btnNextDiff = document.getElementById('btn-next-diff');

        // 文件输入
        this.fileInputOriginal = document.getElementById('file-input-original');
        this.fileInputCompare = document.getElementById('file-input-compare');

        // 信息显示
        this.originalInfo = document.getElementById('original-info');
        this.compareInfo = document.getElementById('compare-info');
        this.similarityValue = document.getElementById('similarity-value');
        this.similarityProgress = document.getElementById('similarity-progress');

        // 行号容器
        this.originalLineNumbers = document.getElementById('original-line-numbers');
        this.compareLineNumbers = document.getElementById('compare-line-numbers');

        // 大文件警告
        this.originalWarning = document.getElementById('original-warning');
        this.compareWarning = document.getElementById('compare-warning');

        // 初始化虚拟化行号
        this.initVirtualLineNumbers();
    }

    /**
     * 初始化虚拟化行号
     */
    initVirtualLineNumbers() {
        // 原始文档行号虚拟滚动
        this.originalLineNumbersContent = document.createElement('div');
        this.originalLineNumbersContent.className = 'line-numbers-content';
        this.originalLineNumbersContent.style.position = 'relative';
        this.originalLineNumbers.innerHTML = '';
        this.originalLineNumbers.appendChild(this.originalLineNumbersContent);

        // 比较文档行号虚拟滚动
        this.compareLineNumbersContent = document.createElement('div');
        this.compareLineNumbersContent.className = 'line-numbers-content';
        this.compareLineNumbersContent.style.position = 'relative';
        this.compareLineNumbers.innerHTML = '';
        this.compareLineNumbers.appendChild(this.compareLineNumbersContent);
    }

    initEditors() {
        // 创建虚拟滚动编辑器
        this.originalEditor = new CompareEditor('original-editor', {
            itemHeight: 22
        });

        this.compareEditor = new CompareEditor('compare-editor', {
            itemHeight: 22
        });

        // 设置滚动同步
        this.originalEditor.virtualScroll.onScroll = (scrollTop) => {
            this.syncScroll('original');
        };

        this.compareEditor.virtualScroll.onScroll = (scrollTop) => {
            this.syncScroll('compare');
        };
    }

    initEventListeners() {
        // 文件导入按钮
        this.btnLoadOriginal.addEventListener('click', () => {
            this.fileInputOriginal.click();
        });

        this.btnLoadCompare.addEventListener('click', () => {
            this.fileInputCompare.click();
        });

        // 文件选择事件
        this.fileInputOriginal.addEventListener('change', (e) => {
            this.loadFile(e.target.files[0], 'original');
        });

        this.fileInputCompare.addEventListener('change', (e) => {
            this.loadFile(e.target.files[0], 'compare');
        });

        // 粘贴按钮
        this.btnPasteOriginal.addEventListener('click', () => {
            this.pasteText('original');
        });

        this.btnPasteCompare.addEventListener('click', () => {
            this.pasteText('compare');
        });

        // 主要操作按钮
        this.btnCompare.addEventListener('click', () => this.performCompare());
        this.btnClear.addEventListener('click', () => this.clearAll());
        this.btnClose.addEventListener('click', () => this.closeWindow());

        // 差异导航
        this.btnPrevDiff.addEventListener('click', () => this.navigateToPrevDiff());
        this.btnNextDiff.addEventListener('click', () => this.navigateToNextDiff());

        // 监听行号容器滚动（防止用户直接滚动行号区域）
        this.originalLineNumbers.addEventListener('scroll', (e) => {
            e.preventDefault();
            this.syncScroll('original');
        });

        this.compareLineNumbers.addEventListener('scroll', (e) => {
            e.preventDefault();
            this.syncScroll('compare');
        });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'Enter':
                        e.preventDefault();
                        this.performCompare();
                        break;
                    case 'w':
                        e.preventDefault();
                        this.closeWindow();
                        break;
                }
            }
        });
    }

    initIPC() {
        // 监听来自主进程的消息
        if (window.electronAPI) {
            window.electronAPI.onCompareData((data) => {
                if (data.original) {
                    if (typeof data.original === 'string') {
                        // 文本型数据源
                        this.setOriginalText(data.original);
                    } else if (data.original.type === 'file') {
                        // 文件型数据源
                        this.setOriginalFile(data.original);
                    }
                }
                if (data.compare) {
                    this.setCompareText(data.compare);
                }
                if (data.autoCompare) {
                    this.performCompare();
                }
            });
        }
    }

    /**
     * 设置原始文档（文件型数据源）
     */
    async setOriginalFile(fileInfo) {
        this.originalFileInfo = fileInfo;
        this.originalText = ''; // 不保存全文

        // 显示文件信息
        this.originalInfo.textContent = `${fileInfo.totalLines.toLocaleString()} 行`;

        // 大文件提示
        if (fileInfo.totalLines > 10000) {
            this.originalWarning.classList.add('visible');
            this.originalWarning.textContent = `大文件模式：已启用虚拟滚动，显示全文（${fileInfo.totalLines.toLocaleString()} 行）；比较操作可能较慢`;
        } else {
            this.originalWarning.classList.remove('visible');
        }

        // 设置虚拟滚动编辑器使用按行读取
        this.originalEditor.setFileSource(fileInfo);
        this.updateLineNumbers('original');
        this.clearCompareResult();
    }

    /**
     * 设置原始文档文本
     */
    setOriginalText(text) {
        this.originalFileInfo = null; // 清除文件信息
        const lines = text.split('\n');
        this.originalText = text;

        // 大文件提示（不截断）
        if (lines.length > 10000) {
            this.originalWarning.classList.add('visible');
            this.originalWarning.textContent = `大文件模式：已启用虚拟滚动，显示全文（${lines.length.toLocaleString()} 行）；比较操作可能较慢`;
        } else {
            this.originalWarning.classList.remove('visible');
        }

        this.originalEditor.setText(this.originalText);
        this.updateLineInfo('original');
        this.updateLineNumbers('original');
        this.clearCompareResult();
    }

    /**
     * 设置比较文档文本
     */
    setCompareText(text) {
        const lines = text.split('\n');
        this.compareText = text;

        // 大文件提示（不截断）
        if (lines.length > 10000) {
            this.compareWarning.classList.add('visible');
            this.compareWarning.textContent = `大文件模式：已启用虚拟滚动，显示全文（${lines.length.toLocaleString()} 行）；比较操作可能较慢`;
        } else {
            this.compareWarning.classList.remove('visible');
        }

        this.compareEditor.setText(this.compareText);
        this.updateLineInfo('compare');
        this.updateLineNumbers('compare');
        this.clearCompareResult();
    }

    /**
     * 加载文件
     */
    async loadFile(file, target) {
        if (!file) return;

        const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

        if (file.size > LARGE_FILE_THRESHOLD) {
            // 大文件：使用 FileReader 分块读取，避免内存溢出
            const shouldContinue = confirm(
                `文件较大（${this.formatFileSize(file.size)}），将使用大文件模式加载。\n` +
                `注意：大文件模式下，虚拟滚动可以正常显示，但比较操作可能较慢。\n\n` +
                `是否继续？`
            );
            if (!shouldContinue) {
                return;
            }

            try {
                // 使用 FileReader 分块读取大文件
                const text = await this.readFileLarge(file);
                if (target === 'original') {
                    this.setOriginalText(text);
                } else {
                    this.setCompareText(text);
                }
            } catch (error) {
                console.error('读取大文件失败:', error);
                alert('读取文件失败: ' + error.message);
            }
        } else {
            // 小文件：使用浏览器 FileReader
            try {
                const text = await this.readFile(file);
                if (target === 'original') {
                    this.setOriginalText(text);
                } else {
                    this.setCompareText(text);
                }
            } catch (error) {
                console.error('读取文件失败:', error);
                alert('读取文件失败: ' + error.message);
            }
        }
    }

    /**
     * 读取大文件（分块读取避免内存溢出）
     */
    async readFileLarge(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            const CHUNK_SIZE = 1024 * 1024; // 1MB 每块
            
            let offset = 0;
            let result = '';
            
            reader.onload = (e) => {
                result += e.target.result;
                offset += CHUNK_SIZE;
                
                if (offset < file.size) {
                    // 继续读取下一块
                    const blob = file.slice(offset, offset + CHUNK_SIZE);
                    reader.readAsText(blob);
                } else {
                    // 读取完成
                    resolve(result);
                }
            };
            
            reader.onerror = (e) => {
                reject(e);
            };
            
            // 开始读取第一块
            const firstBlob = file.slice(0, CHUNK_SIZE);
            reader.readAsText(firstBlob);
        });
    }

    /**
     * 设置比较文档（文件型数据源）
     */
    async setCompareFile(fileInfo) {
        this.compareFileInfo = fileInfo;
        this.compareText = ''; // 不保存全文

        // 显示文件信息
        this.compareInfo.textContent = `${fileInfo.totalLines.toLocaleString()} 行`;

        // 大文件提示
        if (fileInfo.totalLines > 10000) {
            this.compareWarning.classList.add('visible');
            this.compareWarning.textContent = `大文件模式：已启用虚拟滚动，显示全文（${fileInfo.totalLines.toLocaleString()} 行）；比较操作可能较慢`;
        } else {
            this.compareWarning.classList.remove('visible');
        }

        // 设置虚拟滚动编辑器使用按行读取
        this.compareEditor.setCompareFileSource(fileInfo);
        this.updateLineNumbers('compare');
        this.clearCompareResult();
    }

    /**
     * 格式化文件大小
     */
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    /**
     * 读取文件内容
     */
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    }

    /**
     * 粘贴文本
     */
    async pasteText(target) {
        try {
            const text = await navigator.clipboard.readText();
            if (target === 'original') {
                this.setOriginalText(text);
            } else {
                this.setCompareText(text);
            }
        } catch (error) {
            console.error('粘贴失败:', error);
            alert('无法访问剪贴板，请手动粘贴');
        }
    }

    /**
     * 更新行数信息
     */
    updateLineInfo(target) {
        let lineCount;
        if (target === 'original') {
            lineCount = this.originalFileInfo
                ? this.originalFileInfo.totalLines
                : this.originalEditor.getLineCount();
        } else {
            lineCount = this.compareFileInfo
                ? this.compareFileInfo.totalLines
                : this.compareEditor.getLineCount();
        }
        const infoEl = target === 'original' ? this.originalInfo : this.compareInfo;
        infoEl.textContent = `${lineCount.toLocaleString()} 行`;
    }

    /**
     * 更新行号显示（虚拟化）
     */
    updateLineNumbers(target) {
        const editor = target === 'original' ? this.originalEditor : this.compareEditor;
        const lineNumbersEl = target === 'original' ? this.originalLineNumbers : this.compareLineNumbers;
        const lineNumbersContent = target === 'original' ? this.originalLineNumbersContent : this.compareLineNumbersContent;

        // 优先使用文件信息中的行数
        let lineCount;
        if (target === 'original' && this.originalFileInfo) {
            lineCount = this.originalFileInfo.totalLines;
        } else if (target === 'compare' && this.compareFileInfo) {
            lineCount = this.compareFileInfo.totalLines;
        } else {
            lineCount = editor.getLineCount();
        }

        // 设置总高度撑开滚动条
        const totalHeight = lineCount * 22;
        lineNumbersContent.style.height = totalHeight + 'px';

        // 初始渲染可见行号
        this.renderVisibleLineNumbers(target);
    }

    /**
     * 渲染可见行号
     */
    renderVisibleLineNumbers(target) {
        const editor = target === 'original' ? this.originalEditor : this.compareEditor;
        const lineNumbersEl = target === 'original' ? this.originalLineNumbers : this.compareLineNumbers;
        const lineNumbersContent = target === 'original' ? this.originalLineNumbersContent : this.compareLineNumbersContent;

        // 优先使用文件信息中的行数
        let lineCount;
        if (target === 'original' && this.originalFileInfo) {
            lineCount = this.originalFileInfo.totalLines;
        } else if (target === 'compare' && this.compareFileInfo) {
            lineCount = this.compareFileInfo.totalLines;
        } else {
            lineCount = editor.getLineCount();
        }

        // 获取当前可见范围
        const scrollTop = editor.virtualScroll.scrollTop;
        const containerHeight = lineNumbersEl.clientHeight;
        const itemHeight = 22;
        const bufferSize = 5;

        const startLine = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferSize);
        const endLine = Math.min(lineCount - 1, Math.ceil((scrollTop + containerHeight) / itemHeight) + bufferSize);

        // 清空并重新渲染
        lineNumbersContent.innerHTML = '';

        // 创建可视区域容器
        const viewport = document.createElement('div');
        viewport.style.position = 'absolute';
        viewport.style.top = '0';
        viewport.style.left = '0';
        viewport.style.right = '0';
        viewport.style.transform = `translateY(${startLine * itemHeight}px)`;

        // 渲染可见行号
        for (let i = startLine; i <= endLine; i++) {
            const lineEl = document.createElement('div');
            lineEl.className = 'line';
            lineEl.textContent = i + 1;
            lineEl.dataset.line = i + 1;
            lineEl.style.height = itemHeight + 'px';
            lineEl.style.lineHeight = itemHeight + 'px';
            viewport.appendChild(lineEl);
        }

        lineNumbersContent.appendChild(viewport);
    }

    /**
     * 清除比较结果
     */
    clearCompareResult() {
        this.updateSimilarity(0);
        this.diffLines = [];
        this.currentDiffIndex = -1;
        this.originalEditor.setDiffMap(new Map());
        this.compareEditor.setDiffMap(new Map());
        this.updateNavigationButtons();
    }

    /**
     * 执行比较
     */
    async performCompare() {
        // 立即禁用按钮，防止重复点击
        this.isComparing = true;
        this.btnCompare.disabled = true;
        this.btnCompare.textContent = '准备中...';

        try {
            // 获取原始文档文本
            let originalText = '';
            if (this.originalFileInfo) {
                // 文件型数据源：需要读取全文
                this.btnCompare.textContent = '读取原始文档...';

                const BATCH_SIZE = 5000;
                const totalLines = this.originalFileInfo.totalLines;
                const totalBatches = Math.ceil(totalLines / BATCH_SIZE);
                const lines = [];
                let currentBatch = 0;

                for (let batchStart = 1; batchStart <= totalLines; batchStart += BATCH_SIZE) {
                    currentBatch++;
                    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalLines);

                    try {
                        console.log(`[比较] 读取原始文档第 ${currentBatch}/${totalBatches} 批: ${batchStart}-${batchEnd} 行`);
                        const batchLines = await window.electronAPI.readFileLines(batchStart, batchEnd);
                        for (const line of batchLines) {
                            lines.push(line.content);
                        }
                    } catch (error) {
                        console.error(`[比较] 读取第 ${batchStart}-${batchEnd} 行失败:`, error);
                        for (let i = batchStart; i <= batchEnd; i++) {
                            lines.push('');
                        }
                    }

                    // 更新进度：按批次数计算
                    const progress = Math.round((currentBatch / totalBatches) * 25);
                    this.btnCompare.textContent = `读取原始文档... ${progress}%`;

                    // 让出事件循环
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                originalText = lines.join('\n');
                console.log(`[比较] 原始文档读取完成，共 ${lines.length} 行`);
            } else {
                originalText = this.originalText;
            }

            // 获取比较文档文本
            let compareText = '';
            if (this.compareFileInfo) {
                // 文件型数据源：需要读取全文
                this.btnCompare.textContent = '读取比较文档...';

                const BATCH_SIZE = 5000;
                const totalLines = this.compareFileInfo.totalLines;
                const totalBatches = Math.ceil(totalLines / BATCH_SIZE);
                const lines = [];
                let currentBatch = 0;

                for (let batchStart = 1; batchStart <= totalLines; batchStart += BATCH_SIZE) {
                    currentBatch++;
                    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalLines);

                    try {
                        console.log(`[比较] 读取比较文档第 ${currentBatch}/${totalBatches} 批: ${batchStart}-${batchEnd} 行`);
                        const batchLines = await window.electronAPI.readCompareFileLines(batchStart, batchEnd);
                        for (const line of batchLines) {
                            lines.push(line.content);
                        }
                    } catch (error) {
                        console.error(`[比较] 读取第 ${batchStart}-${batchEnd} 行失败:`, error);
                        for (let i = batchStart; i <= batchEnd; i++) {
                            lines.push('');
                        }
                    }

                    // 更新进度：按批次数计算（25-50%）
                    const progress = 25 + Math.round((currentBatch / totalBatches) * 25);
                    this.btnCompare.textContent = `读取比较文档... ${progress}%`;

                    // 让出事件循环
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                compareText = lines.join('\n');
                console.log(`[比较] 比较文档读取完成，共 ${lines.length} 行`);
            } else {
                compareText = this.compareText;
            }

            if (!originalText && !compareText) {
                this.updateSimilarity(0);
                console.log('[比较] 两个文档都为空，跳过比较');
                return;
            }

            this.btnCompare.textContent = '比较中...';

            // 使用 requestAnimationFrame 让 UI 先更新
            await new Promise(resolve => requestAnimationFrame(resolve));

            console.log('[比较] 开始执行比较...');
            console.log(`[比较] 原始文档: ${originalText.length} 字符`);
            console.log(`[比较] 比较文档: ${compareText.length} 字符`);

            // 使用主进程的比较功能
            const result = await window.electronAPI.compareTexts({
                original: originalText,
                compare: compareText
            });

            console.log('[比较] 比较完成:', result);

            this.updateSimilarity(result.similarity);
            this.diffLines = result.diffLines || [];

            // 显示比较模式
            if (result.mode) {
                const modeNames = {
                    'precise': '精确比较',
                    'line': '行级比较',
                    'simplified': '简化比较',
                    'navigation': '导航模式'
                };
                const modeName = modeNames[result.mode] || result.mode;
                this.originalWarning.classList.add('visible');
                this.originalWarning.textContent = `比较模式: ${modeName} | 原始: ${result.originalLines.toLocaleString()} 行 | 比较: ${result.compareLines.toLocaleString()} 行`;
            }

            this.highlightDifferences(result.diffMap);
            this.updateNavigationButtons();

        } catch (error) {
            console.error('[比较] 执行失败:', error);
            console.error('[比较] 错误堆栈:', error.stack);
            alert('比较失败: ' + error.message);
        } finally {
            console.log('[比较] 清理状态');
            this.isComparing = false;
            this.btnCompare.disabled = false;
            this.btnCompare.textContent = '开始比较';
        }
    }

    /**
     * 更新相似度显示
     */
    updateSimilarity(similarity) {
        this.similarityValue.textContent = similarity.toFixed(2) + '%';
        this.similarityProgress.style.width = similarity + '%';

        // 根据相似度改变颜色
        const value = parseFloat(similarity);
        if (value >= 80) {
            this.similarityValue.style.color = '#4ec9b0'; // 绿色
        } else if (value >= 50) {
            this.similarityValue.style.color = '#dcdcaa'; // 黄色
        } else {
            this.similarityValue.style.color = '#f48771'; // 红色
        }
    }

    /**
     * 高亮差异
     */
    highlightDifferences(diffMap) {
        // 创建差异映射
        const diffMapObj = new Map();
        for (const [key, value] of Object.entries(diffMap)) {
            diffMapObj.set(parseInt(key), value);
        }

        // 应用到比较编辑器
        this.compareEditor.setDiffMap(diffMapObj);
    }

    /**
     * 更新导航按钮状态
     */
    updateNavigationButtons() {
        const hasDiffs = this.diffLines.length > 0;
        this.btnPrevDiff.disabled = !hasDiffs;
        this.btnNextDiff.disabled = !hasDiffs;

        if (hasDiffs) {
            this.currentDiffIndex = -1;
        }
    }

    /**
     * 导航到下一处差异
     */
    navigateToNextDiff() {
        if (this.diffLines.length === 0) return;

        this.currentDiffIndex++;
        if (this.currentDiffIndex >= this.diffLines.length) {
            this.currentDiffIndex = 0;
        }

        this.scrollToDiff(this.diffLines[this.currentDiffIndex]);
    }

    /**
     * 导航到上一处差异
     */
    navigateToPrevDiff() {
        if (this.diffLines.length === 0) return;

        this.currentDiffIndex--;
        if (this.currentDiffIndex < 0) {
            this.currentDiffIndex = this.diffLines.length - 1;
        }

        this.scrollToDiff(this.diffLines[this.currentDiffIndex]);
    }

    /**
     * 滚动到指定差异行
     */
    scrollToDiff(lineNum) {
        this.compareEditor.scrollToLine(lineNum);
        this.syncScroll('compare');

        // 高亮当前差异行
        this.highlightCurrentDiff(lineNum);
    }

    /**
     * 高亮当前差异行
     */
    highlightCurrentDiff(lineNum) {
        // 移除之前的高亮
        const prevHighlighted = this.compareLineNumbers.querySelector('.line.current-diff');
        if (prevHighlighted) {
            prevHighlighted.classList.remove('current-diff');
            prevHighlighted.style.backgroundColor = '';
        }

        // 查找当前可见范围内的行号元素
        const lineEl = this.compareLineNumbers.querySelector(`.line[data-line="${lineNum}"]`);
        if (lineEl) {
            lineEl.classList.add('current-diff');
            lineEl.style.backgroundColor = 'rgba(255, 255, 0, 0.5)';

            // 3秒后移除高亮
            setTimeout(() => {
                lineEl.classList.remove('current-diff');
                lineEl.style.backgroundColor = '';
            }, 3000);
        }
    }

    /**
     * 同步滚动
     */
    syncScroll(source) {
        if (source === 'original') {
            // 同步原始文档的行号滚动
            this.originalLineNumbers.scrollTop = this.originalEditor.virtualScroll.scrollTop;
            // 更新虚拟化行号
            this.renderVisibleLineNumbers('original');
        } else {
            // 同步比较文档的行号滚动
            this.compareLineNumbers.scrollTop = this.compareEditor.virtualScroll.scrollTop;
            // 更新虚拟化行号
            this.renderVisibleLineNumbers('compare');
        }
    }

    /**
     * 清空所有内容
     */
    clearAll() {
        this.originalEditor.setText('');
        this.compareEditor.setText('');
        this.originalText = '';
        this.compareText = '';
        this.diffLines = [];
        this.currentDiffIndex = -1;

        this.updateLineInfo('original');
        this.updateLineInfo('compare');
        this.updateLineNumbers('original');
        this.updateLineNumbers('compare');
        this.updateSimilarity(0);
        this.clearCompareResult();
        this.updateNavigationButtons();

        // 隐藏大文件警告
        this.originalWarning.classList.remove('visible');
        this.compareWarning.classList.remove('visible');
    }

    /**
     * 关闭窗口
     */
    closeWindow() {
        if (window.electronAPI) {
            window.electronAPI.closeCompareWindow();
        } else {
            window.close();
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    window.compareRenderer = new CompareRenderer();
});

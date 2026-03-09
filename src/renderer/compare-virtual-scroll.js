/**
 * 比较页面虚拟滚动组件
 * 用于处理大文件的虚拟滚动显示
 */

export class CompareVirtualScroll {
    constructor(container, options = {}) {
        this.container = container;
        this.itemHeight = options.itemHeight || 22;
        this.bufferSize = options.bufferSize || 5;
        this.totalLines = 0;
        this.lines = [];
        this.visibleStart = 0;
        this.visibleEnd = 0;
        this.scrollTop = 0;
        
        this.onRenderItem = options.onRenderItem || (() => {});
        this.onScroll = options.onScroll || (() => {});
        
        this.init();
    }
    
    init() {
        // 创建内容容器
        this.contentEl = document.createElement('div');
        this.contentEl.className = 'virtual-scroll-content';
        this.contentEl.style.position = 'relative';
        
        // 创建可视区域容器
        this.viewportEl = document.createElement('div');
        this.viewportEl.className = 'virtual-scroll-viewport';
        this.viewportEl.style.position = 'absolute';
        this.viewportEl.style.top = '0';
        this.viewportEl.style.left = '0';
        this.viewportEl.style.right = '0';
        
        this.contentEl.appendChild(this.viewportEl);
        this.container.appendChild(this.contentEl);
        
        // 监听滚动
        this.container.addEventListener('scroll', () => this.onContainerScroll());
        
        // 监听容器大小变化
        this.resizeObserver = new ResizeObserver(() => this.updateVisibleRange());
        this.resizeObserver.observe(this.container);
    }
    
    /**
     * 设置数据
     */
    setData(lines) {
        this.lines = lines || [];
        this.totalLines = this.lines.length;
        this.updateContentHeight();
        this.updateVisibleRange();
    }
    
    /**
     * 更新内容高度
     */
    updateContentHeight() {
        const totalHeight = this.totalLines * this.itemHeight;
        this.contentEl.style.height = `${totalHeight}px`;
    }
    
    /**
     * 处理容器滚动
     */
    onContainerScroll() {
        this.scrollTop = this.container.scrollTop;
        this.updateVisibleRange();
        this.onScroll(this.scrollTop);
    }
    
    /**
     * 更新可视范围
     */
    updateVisibleRange() {
        const containerHeight = this.container.clientHeight;
        
        // 计算可视范围
        const startIndex = Math.floor(this.scrollTop / this.itemHeight);
        const visibleCount = Math.ceil(containerHeight / this.itemHeight);
        
        // 添加缓冲区
        const bufferStart = Math.max(0, startIndex - this.bufferSize);
        const bufferEnd = Math.min(this.totalLines, startIndex + visibleCount + this.bufferSize);
        
        // 如果范围没有变化，不重新渲染
        if (bufferStart === this.visibleStart && bufferEnd === this.visibleEnd) {
            return;
        }
        
        this.visibleStart = bufferStart;
        this.visibleEnd = bufferEnd;
        
        this.render();
    }
    
    /**
     * 渲染可视区域
     */
    render() {
        // 清空可视区域
        this.viewportEl.innerHTML = '';
        
        // 设置可视区域位置
        const offsetTop = this.visibleStart * this.itemHeight;
        this.viewportEl.style.transform = `translateY(${offsetTop}px)`;
        
        // 渲染可见行
        for (let i = this.visibleStart; i < this.visibleEnd; i++) {
            if (i >= this.totalLines) break;
            
            const item = this.onRenderItem(i, this.lines[i]);
            if (item) {
                item.style.height = `${this.itemHeight}px`;
                item.style.boxSizing = 'border-box';
                this.viewportEl.appendChild(item);
            }
        }
    }
    
    /**
     * 滚动到指定行
     */
    scrollToLine(lineNum) {
        const scrollTop = (lineNum - 1) * this.itemHeight;
        this.container.scrollTop = scrollTop;
    }
    
    /**
     * 获取当前滚动位置对应的行号
     */
    getCurrentLine() {
        return Math.floor(this.scrollTop / this.itemHeight) + 1;
    }
    
    /**
     * 刷新显示
     */
    refresh() {
        this.updateVisibleRange();
    }
    
    /**
     * 销毁组件
     */
    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        this.container.removeEventListener('scroll', () => this.onContainerScroll());
        this.contentEl.remove();
    }
}

/**
 * 比较页面文本编辑器（使用虚拟滚动）
 */
export class CompareEditor {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container #${containerId} not found`);
        }
        
        this.itemHeight = options.itemHeight || 22;
        this.lines = [];
        this.diffMap = new Map();
        
        // 文件型数据源支持
        this.fileSource = null;
        this.lineCache = new Map();
        this.maxCacheSize = 500;
        
        this.init();
    }
    
    init() {
        // 清空容器
        this.container.innerHTML = '';
        
        // 创建编辑器容器
        this.editorEl = document.createElement('div');
        this.editorEl.className = 'compare-editor';
        this.editorEl.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            overflow: auto;
            font-family: Consolas, 'Courier New', monospace;
            font-size: 14px;
            line-height: ${this.itemHeight}px;
            background-color: #1e1e1e;
            color: #d4d4d4;
        `;
        
        this.container.appendChild(this.editorEl);
        
        // 创建虚拟滚动
        this.virtualScroll = new CompareVirtualScroll(this.editorEl, {
            itemHeight: this.itemHeight,
            bufferSize: 10,
            onRenderItem: (index, line) => this.renderLine(index, line),
            onScroll: (scrollTop) => this.onScroll(scrollTop)
        });
    }
    
    /**
     * 渲染单行
     */
    renderLine(index, line) {
        const lineEl = document.createElement('div');
        lineEl.className = 'editor-line';
        lineEl.style.cssText = `
            padding: 0 10px;
            white-space: pre;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        
        // 如果是文件型数据源，按需读取内容
        if (this.fileSource && !line) {
            this.loadLineFromFile(index, lineEl);
            lineEl.textContent = '加载中...';
        } else {
            lineEl.textContent = line || '';
        }
        
        // 应用差异样式
        const lineNum = index + 1;
        const diffType = this.diffMap.get(lineNum);
        if (diffType) {
            lineEl.classList.add(`diff-${diffType}`);
            lineEl.style.backgroundColor = this.getDiffColor(diffType);
        }
        
        return lineEl;
    }

    /**
     * 从文件按需读取行内容
     */
    async loadLineFromFile(index, lineEl) {
        if (!this.fileSource) return;

        const lineNum = index + 1;

        // 检查缓存
        if (this.lineCache.has(lineNum)) {
            lineEl.textContent = this.lineCache.get(lineNum) || '';
            return;
        }

        try {
            // 批量读取附近行
            const startLine = Math.max(1, lineNum - 5);
            const endLine = Math.min(this.fileSource.totalLines, lineNum + 5);

            // 根据文档类型选择正确的读取 API
            let lines;
            if (this.isCompareFile) {
                lines = await window.electronAPI.readCompareFileLines(startLine, endLine);
            } else {
                lines = await window.electronAPI.readFileLines(startLine, endLine);
            }

            // 缓存读取的行
            for (const line of lines) {
                if (this.lineCache.size >= this.maxCacheSize) {
                    const firstKey = this.lineCache.keys().next().value;
                    this.lineCache.delete(firstKey);
                }
                this.lineCache.set(line.lineNum, line.content);
            }

            // 更新当前行
            const currentLine = this.lineCache.get(lineNum);
            if (lineEl && lineEl.parentNode) {
                lineEl.textContent = currentLine || '';
            }
        } catch (error) {
            console.error(`读取第 ${lineNum} 行失败:`, error);
            if (lineEl && lineEl.parentNode) {
                lineEl.textContent = '';
            }
        }
    }
    
    /**
     * 获取差异颜色
     */
    getDiffColor(diffType) {
        switch (diffType) {
            case 'added':
                return 'rgba(215, 186, 125, 0.15)';
            case 'modified':
                return 'rgba(0, 122, 204, 0.15)';
            case 'deleted':
                return 'rgba(244, 135, 113, 0.15)';
            default:
                return 'transparent';
        }
    }
    
    /**
     * 设置文本内容
     */
    setText(text) {
        this.fileSource = null; // 清除文件型数据源
        this.lines = text ? text.split('\n') : [];
        this.virtualScroll.setData(this.lines);
    }

    /**
     * 设置文件型数据源
     */
    setFileSource(fileInfo) {
        this.fileSource = fileInfo;
        this.isCompareFile = false; // 标记为原始文档
        this.lines = []; // 不保存全文
        this.lineCache.clear();

        // 创建占位数组，虚拟滚动只渲染可见区域
        const placeholderLines = new Array(fileInfo.totalLines).fill('');
        this.virtualScroll.setData(placeholderLines);
    }

    /**
     * 设置比较文档文件型数据源
     */
    setCompareFileSource(fileInfo) {
        this.fileSource = fileInfo;
        this.isCompareFile = true; // 标记为比较文档
        this.lines = []; // 不保存全文
        this.lineCache.clear();

        // 创建占位数组，虚拟滚动只渲染可见区域
        const placeholderLines = new Array(fileInfo.totalLines).fill('');
        this.virtualScroll.setData(placeholderLines);
    }

    /**
     * 获取文本内容
     */
    getText() {
        if (this.fileSource) {
            // 文件型数据源：需要读取全文
            return this.getFullTextFromFile();
        }
        return this.lines.join('\n');
    }

    /**
     * 从文件读取全文（用于比较）
     */
    async getFullTextFromFile() {
        if (!this.fileSource) return '';

        const lines = [];
        const BATCH_SIZE = 1000;
        const totalLines = this.fileSource.totalLines;

        for (let batchStart = 1; batchStart <= totalLines; batchStart += BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalLines);

            try {
                // 根据文档类型选择正确的读取 API
                let batchLines;
                if (this.isCompareFile) {
                    batchLines = await window.electronAPI.readCompareFileLines(batchStart, batchEnd);
                } else {
                    batchLines = await window.electronAPI.readFileLines(batchStart, batchEnd);
                }
                for (const line of batchLines) {
                    lines.push(line.content);
                }
            } catch (error) {
                console.error(`读取第 ${batchStart}-${batchEnd} 行失败:`, error);
                for (let i = batchStart; i <= batchEnd; i++) {
                    lines.push('');
                }
            }
        }

        return lines.join('\n');
    }
    
    /**
     * 设置差异映射
     */
    setDiffMap(diffMap) {
        this.diffMap = diffMap || new Map();
        this.virtualScroll.refresh();
    }
    
    /**
     * 滚动到指定行
     */
    scrollToLine(lineNum) {
        this.virtualScroll.scrollToLine(lineNum);
    }
    
    /**
     * 获取当前行号
     */
    getCurrentLine() {
        return this.virtualScroll.getCurrentLine();
    }
    
    /**
     * 获取总行数
     */
    getLineCount() {
        if (this.fileSource) {
            return this.fileSource.totalLines;
        }
        return this.lines.length;
    }
    
    /**
     * 滚动事件
     */
    onScroll(scrollTop) {
        // 可以在这里实现同步滚动
    }
    
    /**
     * 销毁编辑器
     */
    destroy() {
        if (this.virtualScroll) {
            this.virtualScroll.destroy();
        }
    }
}

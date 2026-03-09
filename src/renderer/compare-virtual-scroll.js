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
        lineEl.textContent = line || '';
        
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
        this.lines = text ? text.split('\n') : [];
        this.virtualScroll.setData(this.lines);
    }
    
    /**
     * 获取文本内容
     */
    getText() {
        return this.lines.join('\n');
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

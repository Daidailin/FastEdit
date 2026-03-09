/**
 * 虚拟滚动列表控件 - 支持超大文件
 * 使用两层定位结构：
 * 1. 总内容层：撑开滚动条，使用虚拟高度
 * 2. 可视区域块：按真实行高排布，使用 transform 定位到虚拟位置
 */
class VirtualScrollList {
    constructor(options) {
        this.container = options.container;
        this.itemHeight = options.itemHeight || 24;
        this.totalItems = options.totalItems || 0;
        this.renderItem = options.renderItem || (() => document.createElement('div'));
        this.bufferSize = options.bufferSize || 5;

        this.visibleStart = 0;
        this.visibleEnd = 0;
        this.scrollTop = 0;
        this.containerHeight = options.containerHeight || this.container.clientHeight || 600;

        this.itemsCache = new Map();
        this.maxCacheSize = 100;

        // 滚动缩放相关
        this.maxBrowserHeight = 15000000; // 浏览器最大高度限制（约1500万像素）
        this.scrollScale = 1; // 滚动缩放因子
        this.virtualHeight = 0; // 虚拟高度（用于滚动条）
        this.actualHeight = 0; // 实际高度

        this.init();
    }

    init() {
        // 清空容器
        this.container.innerHTML = '';

        // 第一层：总内容层 - 用于撑开滚动条
        this.contentEl = document.createElement('div');
        this.contentEl.style.position = 'relative';
        this.contentEl.style.width = '100%';
        this.container.appendChild(this.contentEl);

        // 第二层：可视区域块 - 按真实行高排布
        this.viewportEl = document.createElement('div');
        this.viewportEl.style.position = 'absolute';
        this.viewportEl.style.top = '0';
        this.viewportEl.style.left = '0';
        this.viewportEl.style.right = '0';
        this.contentEl.appendChild(this.viewportEl);

        this.updateContentHeight();

        // 绑定滚动事件
        this.handleScroll = this.handleScroll.bind(this);
        this.container.addEventListener('scroll', this.handleScroll, { passive: true });

        // 调试信息
        console.log('VirtualScrollList 初始化:', {
            totalItems: this.totalItems,
            itemHeight: this.itemHeight,
            containerHeight: this.containerHeight,
            virtualHeight: this.virtualHeight,
            actualHeight: this.actualHeight,
            scrollScale: this.scrollScale
        });

        // 初始渲染
        this.render();
    }

    handleScroll() {
        this.scrollTop = this.container.scrollTop;
        this.render();
    }

    updateContentHeight() {
        // 计算实际高度
        this.actualHeight = this.totalItems * this.itemHeight;

        // 如果实际高度超过浏览器限制，使用缩放
        if (this.actualHeight > this.maxBrowserHeight) {
            this.scrollScale = this.actualHeight / this.maxBrowserHeight;
            this.virtualHeight = this.maxBrowserHeight;
        } else {
            this.scrollScale = 1;
            this.virtualHeight = this.actualHeight;
        }

        // 第一层：设置虚拟高度撑开滚动条
        this.contentEl.style.height = this.virtualHeight + 'px';
    }

    /**
     * 将虚拟滚动位置转换为实际行索引（0-based）
     */
    virtualToActual(virtualScrollTop) {
        if (this.scrollScale <= 1) {
            return Math.floor(virtualScrollTop / this.itemHeight);
        }
        return Math.floor((virtualScrollTop / this.virtualHeight) * this.totalItems);
    }

    /**
     * 将实际行索引转换为虚拟滚动位置
     */
    actualToVirtual(actualIndex) {
        if (this.scrollScale <= 1) {
            return actualIndex * this.itemHeight;
        }
        return Math.floor((actualIndex / this.totalItems) * this.virtualHeight);
    }

    setTotalItems(count) {
        this.totalItems = count;
        this.updateContentHeight();
        this.render();
    }

    setContainerHeight(height) {
        this.containerHeight = height;
        this.render();
    }

    render() {
        const containerHeight = this.containerHeight;

        // 计算当前可视区域的行号范围
        let start, end;
        const visibleCount = Math.ceil(containerHeight / this.itemHeight) + this.bufferSize * 2;

        if (this.scrollScale > 1) {
            // 缩放模式：根据虚拟滚动位置计算实际行索引
            const actualStartIndex = this.virtualToActual(this.scrollTop);
            start = Math.max(0, actualStartIndex - this.bufferSize);
            end = Math.min(this.totalItems - 1, start + visibleCount);
        } else {
            // 正常模式
            start = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - this.bufferSize);
            end = Math.min(this.totalItems - 1, start + visibleCount);
        }

        // 清理不再可见的项
        this.cleanupInvisibleItems(start, end);

        // 第二层：设置可视区域块在虚拟空间中的位置
        const viewportVirtualTop = this.actualToVirtual(start);
        this.viewportEl.style.transform = `translateY(${viewportVirtualTop}px)`;

        // 渲染可见范围内的项 - 按真实行高顺序排布
        for (let i = start; i <= end; i++) {
            let itemEl = this.itemsCache.get(i);

            if (!itemEl) {
                itemEl = this.renderItem(i);
                itemEl.style.position = 'relative'; // 相对定位，按真实行高顺序排布
                itemEl.style.height = this.itemHeight + 'px';
                itemEl.dataset.index = i;
                this.viewportEl.appendChild(itemEl);
                this.addToCache(i, itemEl);
            }
        }

        this.visibleStart = start;
        this.visibleEnd = end;
    }

    cleanupInvisibleItems(visibleStart, visibleEnd) {
        const toRemove = [];
        for (const [index, element] of this.itemsCache) {
            if (index < visibleStart || index > visibleEnd) {
                toRemove.push(index);
            }
        }

        for (const index of toRemove) {
            const element = this.itemsCache.get(index);
            if (element) {
                element.remove();
            }
            this.itemsCache.delete(index);
        }
    }

    addToCache(index, element) {
        if (this.itemsCache.size >= this.maxCacheSize) {
            const firstKey = this.itemsCache.keys().next().value;
            const firstEl = this.itemsCache.get(firstKey);
            if (firstEl) firstEl.remove();
            this.itemsCache.delete(firstKey);
        }
        this.itemsCache.set(index, element);
    }

    scrollToItem(index) {
        const virtualTop = this.actualToVirtual(index);
        this.container.scrollTop = virtualTop;
    }

    /**
     * 获取当前滚动位置对应的实际行索引（0-based）
     */
    getCurrentLine() {
        return this.virtualToActual(this.scrollTop);
    }

    refresh() {
        // 清除缓存
        this.itemsCache.forEach(el => el.remove());
        this.itemsCache.clear();
        this.render();
    }

    destroy() {
        this.container.removeEventListener('scroll', this.handleScroll);
        this.container.innerHTML = '';
        this.itemsCache.clear();
    }
}

export { VirtualScrollList };

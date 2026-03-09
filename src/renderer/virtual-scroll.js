/**
 * 虚拟滚动列表控件
 * 只渲染当前可视区域的项，滚动时动态计算并更新
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
        // 优先使用传入的容器高度，否则使用容器的实际高度，最后使用默认值
        this.containerHeight = options.containerHeight || this.container.clientHeight || 600;

        this.itemsCache = new Map();
        this.maxCacheSize = 100;

        this.init();
    }

    init() {
        // 清空容器
        this.container.innerHTML = '';

        // 不要覆盖容器的 position 和 overflow 样式
        // 容器应该已经通过 CSS 设置了正确的样式

        // 创建内容容器 - 使用一个大的div撑开滚动条
        this.contentEl = document.createElement('div');
        this.contentEl.style.position = 'relative';
        this.contentEl.style.width = '100%';
        this.container.appendChild(this.contentEl);

        this.updateContentHeight();

        // 绑定滚动事件
        this.handleScroll = this.handleScroll.bind(this);
        this.container.addEventListener('scroll', this.handleScroll, { passive: true });

        // 调试信息
        console.log('VirtualScrollList 初始化:', {
            totalItems: this.totalItems,
            itemHeight: this.itemHeight,
            containerHeight: this.containerHeight,
            containerClientHeight: this.container.clientHeight,
            contentHeight: this.contentEl.style.height,
            containerOverflow: window.getComputedStyle(this.container).overflow,
            containerPosition: window.getComputedStyle(this.container).position
        });

        // 初始渲染
        this.render();
    }

    handleScroll() {
        this.scrollTop = this.container.scrollTop;
        this.render();
    }

    updateContentHeight() {
        const totalHeight = this.totalItems * this.itemHeight;
        this.contentEl.style.height = totalHeight + 'px';
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
        const start = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - this.bufferSize);
        const visibleCount = Math.ceil(containerHeight / this.itemHeight) + this.bufferSize * 2;
        const end = Math.min(this.totalItems - 1, start + visibleCount);

        // 清理不再可见的项
        this.cleanupInvisibleItems(start, end);

        // 渲染可见范围内的项
        for (let i = start; i <= end; i++) {
            let itemEl = this.itemsCache.get(i);

            if (!itemEl) {
                try {
                    itemEl = this.renderItem(i);
                    itemEl.style.position = 'absolute';
                    itemEl.style.left = '0';
                    itemEl.style.right = '0';
                    itemEl.style.height = this.itemHeight + 'px';
                    itemEl.style.top = (i * this.itemHeight) + 'px';
                    itemEl.dataset.index = i;
                    this.contentEl.appendChild(itemEl);
                    this.addToCache(i, itemEl);
                } catch (error) {
                    console.error(`渲染第 ${i} 项失败:`, error);
                }
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
        this.container.scrollTop = index * this.itemHeight;
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

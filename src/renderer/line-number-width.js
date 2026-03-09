/**
 * 动态行号宽度管理器
 * 根据可视区域的最大行号位数自动计算行号容器宽度
 */
class LineNumberWidthManager {
    constructor(options = {}) {
        this.minWidth = options.minWidth || 40; // 最小宽度
        this.padding = options.padding || 20; // 左右内边距总和
        this.extraDigits = options.extraDigits || 1; // 额外预留位数（防止频繁调整）

        this.currentWidth = this.minWidth;
        this.lastVisibleDigits = 0;

        // 创建测量用的 canvas
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');

        // 缓存测量结果
        this.widthCache = new Map();
    }

    /**
     * 设置字体信息
     * @param {string} font - CSS font 字符串，如 "16px Consolas"
     */
    setFont(font) {
        this.ctx.font = font;
        // 字体变化时清空缓存
        this.widthCache.clear();
    }

    /**
     * 计算指定行号所需的宽度
     * @param {number} lineNum - 行号
     * @returns {number} 所需宽度（像素）
     */
    measureLineNumber(lineNum) {
        const text = String(lineNum);
        const metrics = this.ctx.measureText(text);
        return Math.ceil(metrics.width);
    }

    /**
     * 计算可视区域最大行号所需的宽度
     * @param {number} visibleMaxLineNum - 可视区域最大行号
     * @returns {number} 建议的容器宽度
     */
    calculateWidth(visibleMaxLineNum) {
        // 预留额外位数，避免频繁调整
        const digits = String(visibleMaxLineNum).length;
        const paddedMaxLineNum = Math.pow(10, digits + this.extraDigits) - 1;

        // 检查缓存
        const cacheKey = `${this.ctx.font}_${paddedMaxLineNum}`;
        if (this.widthCache.has(cacheKey)) {
            return this.widthCache.get(cacheKey);
        }

        // 测量最大行号的宽度
        const textWidth = this.measureLineNumber(paddedMaxLineNum);
        const width = Math.max(this.minWidth, textWidth + this.padding);

        // 缓存结果
        this.widthCache.set(cacheKey, width);

        return width;
    }

    /**
     * 检查是否需要更新宽度
     * @param {number} visibleMaxLineNum - 可视区域最大行号
     * @returns {boolean} 是否需要更新
     */
    shouldUpdate(visibleMaxLineNum) {
        // 如果可视区域行号位数发生变化，需要更新
        const newDigits = String(visibleMaxLineNum).length;
        return this.lastVisibleDigits !== newDigits;
    }

    /**
     * 更新宽度（仅在必要时）
     * @param {number} visibleMaxLineNum - 可视区域最大行号
     * @returns {object|null} 更新结果 { oldWidth, newWidth } 或 null（无需更新）
     */
    update(visibleMaxLineNum) {
        if (!this.shouldUpdate(visibleMaxLineNum)) {
            return null;
        }

        const oldWidth = this.currentWidth;
        const newWidth = this.calculateWidth(visibleMaxLineNum);

        this.lastVisibleDigits = String(visibleMaxLineNum).length;

        if (oldWidth !== newWidth) {
            this.currentWidth = newWidth;
            return { oldWidth, newWidth };
        }

        return null;
    }

    /**
     * 强制更新宽度
     * @param {number} visibleMaxLineNum - 可视区域最大行号
     * @returns {object} 更新结果 { oldWidth, newWidth }
     */
    forceUpdate(visibleMaxLineNum) {
        const oldWidth = this.currentWidth;
        const newWidth = this.calculateWidth(visibleMaxLineNum);

        this.lastVisibleDigits = String(visibleMaxLineNum).length;
        this.currentWidth = newWidth;

        return { oldWidth, newWidth };
    }

    /**
     * 获取当前宽度
     * @returns {number} 当前宽度
     */
    getWidth() {
        return this.currentWidth;
    }

    /**
     * 销毁资源
     */
    destroy() {
        this.widthCache.clear();
        this.canvas = null;
        this.ctx = null;
    }
}

export { LineNumberWidthManager };

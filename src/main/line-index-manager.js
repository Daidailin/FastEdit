/**
 * 高效行索引管理器
 * 支持稀疏索引、渐进式构建、内存分页和磁盘缓存
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * 索引块 - 内存分页的基本单位
 */
class IndexBlock {
    constructor(blockId, startLine, capacity) {
        this.blockId = blockId;
        this.startLine = startLine;  // 起始行号（1-based）
        this.offsets = new Uint32Array(capacity);  // 行偏移量数组
        this.count = 0;  // 当前块中的行数
        this.lastAccessTime = Date.now();
        this.dirty = false;
    }

    /**
     * 添加行偏移量
     */
    addOffset(offset) {
        if (this.count >= this.offsets.length) {
            // 动态扩容
            const newCapacity = Math.floor(this.offsets.length * 1.5);
            const newOffsets = new Uint32Array(newCapacity);
            newOffsets.set(this.offsets);
            this.offsets = newOffsets;
        }
        this.offsets[this.count++] = offset;
        this.dirty = true;
        this.lastAccessTime = Date.now();
    }

    /**
     * 获取指定行的偏移量
     */
    getOffset(localLineNum) {
        this.lastAccessTime = Date.now();
        if (localLineNum < 1 || localLineNum > this.count) {
            return null;
        }
        return this.offsets[localLineNum - 1];
    }

    /**
     * 获取行长度
     */
    getLineLength(localLineNum) {
        if (localLineNum < 1 || localLineNum > this.count) {
            return 0;
        }
        const currentOffset = this.offsets[localLineNum - 1];
        if (localLineNum < this.count) {
            return this.offsets[localLineNum] - currentOffset;
        }
        return null; // 需要文件大小来计算
    }

    /**
     * 序列化块数据
     */
    serialize() {
        const buffer = Buffer.allocUnsafe(8 + this.count * 4);
        buffer.writeUInt32LE(this.startLine, 0);
        buffer.writeUInt32LE(this.count, 4);
        for (let i = 0; i < this.count; i++) {
            buffer.writeUInt32LE(this.offsets[i], 8 + i * 4);
        }
        return buffer;
    }

    /**
     * 反序列化块数据
     */
    static deserialize(buffer) {
        const startLine = buffer.readUInt32LE(0);
        const count = buffer.readUInt32LE(4);
        const block = new IndexBlock(0, startLine, count);
        block.count = count;
        for (let i = 0; i < count; i++) {
            block.offsets[i] = buffer.readUInt32LE(8 + i * 4);
        }
        return block;
    }
}

/**
 * 稀疏索引策略
 */
class SparseIndexStrategy {
    constructor(options = {}) {
        this.baseDensity = options.baseDensity || 1;  // 基础索引密度（每N行一个索引点）
        this.adaptiveMode = options.adaptiveMode !== false;  // 是否启用自适应模式
        this.minDensity = options.minDensity || 1;
        this.maxDensity = options.maxDensity || 1000;
        this.queryHistory = [];  // 查询历史，用于自适应调整
        this.maxHistorySize = 1000;
    }

    /**
     * 获取指定行的索引密度
     */
    getDensity(lineNum, fileStats = {}) {
        if (!this.adaptiveMode) {
            return this.baseDensity;
        }

        // 根据文件区域动态调整密度
        // 文件开头和结尾通常访问更频繁，使用更高密度
        const totalLines = fileStats.totalLines || 1000000;
        const position = lineNum / totalLines;
        
        if (position < 0.1 || position > 0.9) {
            return Math.max(1, Math.floor(this.baseDensity * 0.5));  // 开头结尾密度翻倍
        }
        
        return this.baseDensity;
    }

    /**
     * 记录查询历史，用于自适应优化
     */
    recordQuery(lineNum) {
        this.queryHistory.push({
            lineNum,
            timestamp: Date.now()
        });
        
        // 限制历史记录大小
        if (this.queryHistory.length > this.maxHistorySize) {
            this.queryHistory.shift();
        }
    }

    /**
     * 分析查询模式，优化索引密度
     */
    analyzeAndOptimize() {
        if (this.queryHistory.length < 100) return;

        // 计算热点区域
        const hotspots = new Map();
        for (const query of this.queryHistory) {
            const region = Math.floor(query.lineNum / 10000);  // 每10000行为一个区域
            hotspots.set(region, (hotspots.get(region) || 0) + 1);
        }

        // 根据热点调整策略
        // 实际实现中可以根据热点动态调整索引密度
        return hotspots;
    }
}

/**
 * 内存分页管理器
 */
class MemoryPageManager {
    constructor(options = {}) {
        this.maxMemoryBlocks = options.maxMemoryBlocks || 100;  // 最大内存块数
        this.blocks = new Map();  // blockId -> IndexBlock
        this.lruQueue = [];  // LRU队列
        this.diskCachePath = options.diskCachePath || null;
        this.memoryUsage = 0;
        this.maxMemoryUsage = options.maxMemoryUsage || 500 * 1024 * 1024;  // 500MB
    }

    /**
     * 获取块，如果不存在则从磁盘加载
     */
    async getBlock(blockId, loader = null) {
        // 检查内存中是否存在
        if (this.blocks.has(blockId)) {
            this.updateLRU(blockId);
            return this.blocks.get(blockId);
        }

        // 尝试从磁盘加载
        if (this.diskCachePath) {
            const block = await this.loadBlockFromDisk(blockId);
            if (block) {
                await this.addBlockToMemory(blockId, block);
                return block;
            }
        }

        // 使用加载器创建新块
        if (loader) {
            const block = await loader(blockId);
            if (block) {
                await this.addBlockToMemory(blockId, block);
                return block;
            }
        }

        return null;
    }

    /**
     * 添加块到内存
     */
    async addBlockToMemory(blockId, block) {
        // 检查内存限制
        while (this.blocks.size >= this.maxMemoryBlocks || 
               this.memoryUsage >= this.maxMemoryUsage) {
            await this.evictLRUBlock();
        }

        this.blocks.set(blockId, block);
        this.lruQueue.push(blockId);
        this.memoryUsage += this.calculateBlockSize(block);
    }

    /**
     * 更新LRU队列
     */
    updateLRU(blockId) {
        const index = this.lruQueue.indexOf(blockId);
        if (index > -1) {
            this.lruQueue.splice(index, 1);
            this.lruQueue.push(blockId);
        }
    }

    /**
     * 淘汰最久未使用的块
     */
    async evictLRUBlock() {
        if (this.lruQueue.length === 0) return;

        const blockId = this.lruQueue.shift();
        const block = this.blocks.get(blockId);
        
        if (block && block.dirty && this.diskCachePath) {
            await this.saveBlockToDisk(blockId, block);
        }

        this.memoryUsage -= this.calculateBlockSize(block);
        this.blocks.delete(blockId);
    }

    /**
     * 计算块大小
     */
    calculateBlockSize(block) {
        return 32 + block.offsets.length * 4;  // 基础开销 + 偏移量数组
    }

    /**
     * 保存块到磁盘
     */
    async saveBlockToDisk(blockId, block) {
        if (!this.diskCachePath) return;

        const filePath = path.join(this.diskCachePath, `block_${blockId}.idx`);
        const data = block.serialize();
        await fs.promises.writeFile(filePath, data);
    }

    /**
     * 从磁盘加载块
     */
    async loadBlockFromDisk(blockId) {
        if (!this.diskCachePath) return null;

        try {
            const filePath = path.join(this.diskCachePath, `block_${blockId}.idx`);
            const data = await fs.promises.readFile(filePath);
            return IndexBlock.deserialize(data);
        } catch (e) {
            return null;
        }
    }
}

/**
 * 行索引管理器 - 主类
 */
class LineIndexManager extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // 基础配置
        this.blockSize = options.blockSize || 10000;  // 每个块包含的行数
        this.maxMemoryUsage = options.maxMemoryUsage || 500 * 1024 * 1024;  // 500MB
        
        // 组件初始化
        this.sparseStrategy = new SparseIndexStrategy(options.sparseOptions);
        this.pageManager = new MemoryPageManager({
            maxMemoryBlocks: options.maxMemoryBlocks || 100,
            maxMemoryUsage: this.maxMemoryUsage,
            diskCachePath: options.diskCachePath
        });

        // 索引状态
        this.blocks = new Map();  // blockIndex -> blockInfo
        this.totalLines = 0;
        this.fileSize = 0;
        this.filePath = null;
        this.isBuilding = false;
        this.buildProgress = 0;
        this.buildQueue = [];  // 索引构建任务队列
        this.isPaused = false;

        // 统计信息
        this.stats = {
            totalQueries: 0,
            cacheHits: 0,
            cacheMisses: 0,
            avgQueryTime: 0,
            buildTime: 0
        };

        // 线程安全
        this.queryLock = new Map();
        this.buildLock = false;
    }

    /**
     * 初始化索引管理器
     */
    async initialize(filePath, fileSize) {
        this.filePath = filePath;
        this.fileSize = fileSize;
        this.totalLines = 0;
        this.blocks.clear();
        this.buildProgress = 0;
        
        // 尝试加载持久化的索引
        const loaded = await this.loadIndex();
        if (loaded) {
            this.emit('index-loaded', { totalLines: this.totalLines });
            return true;
        }

        return false;
    }

    /**
     * 渐进式索引构建
     */
    async buildIndex(readBufferFn, options = {}) {
        if (this.buildLock) {
            throw new Error('索引构建已在进行中');
        }

        this.buildLock = true;
        this.isBuilding = true;
        const startTime = Date.now();

        try {
            const chunkSize = options.chunkSize || 8 * 1024 * 1024;  // 8MB
            let currentBlock = null;
            let currentBlockId = 0;
            let processedBytes = 0;
            let lineCount = 0;

            // 创建第一个块
            currentBlock = new IndexBlock(0, 1, this.blockSize);

            for (let offset = 0; offset < this.fileSize; offset += chunkSize) {
                // 检查是否暂停
                while (this.isPaused) {
                    await this.sleep(100);
                }

                // 检查任务队列优先级
                if (this.buildQueue.length > 0) {
                    const priorityTask = this.buildQueue.shift();
                    await this.handlePriorityTask(priorityTask);
                }

                const readSize = Math.min(chunkSize, this.fileSize - offset);
                const buffer = await readBufferFn(offset, readSize);

                // 处理缓冲区中的换行符
                for (let i = 0; i < buffer.length; i++) {
                    if (buffer[i] === 0x0A) {  // LF
                        lineCount++;
                        const lineOffset = offset + i + 1;

                        // 检查是否需要创建新块
                        if (lineCount % this.blockSize === 0) {
                            // 保存当前块
                            await this.pageManager.addBlockToMemory(currentBlockId, currentBlock);
                            this.blocks.set(currentBlockId, {
                                startLine: currentBlock.startLine,
                                lineCount: currentBlock.count
                            });

                            // 创建新块
                            currentBlockId++;
                            currentBlock = new IndexBlock(
                                currentBlockId,
                                lineCount + 1,
                                this.blockSize
                            );
                        }

                        currentBlock.addOffset(lineOffset);
                    }
                }

                processedBytes += readSize;
                this.buildProgress = processedBytes / this.fileSize;

                // 发送进度事件
                if (options.onProgress) {
                    options.onProgress({
                        percent: Math.round(this.buildProgress * 100),
                        processedBytes,
                        totalBytes: this.fileSize,
                        lineCount
                    });
                }

                this.emit('build-progress', {
                    percent: this.buildProgress,
                    lineCount
                });

                // 让出时间片
                if (processedBytes % (chunkSize * 10) === 0) {
                    await this.sleep(0);
                }
            }

            // 保存最后一个块
            if (currentBlock.count > 0) {
                await this.pageManager.addBlockToMemory(currentBlockId, currentBlock);
                this.blocks.set(currentBlockId, {
                    startLine: currentBlock.startLine,
                    lineCount: currentBlock.count
                });
            }

            this.totalLines = lineCount;
            this.stats.buildTime = Date.now() - startTime;
            this.isBuilding = false;
            this.buildLock = false;

            this.emit('build-complete', {
                totalLines: this.totalLines,
                buildTime: this.stats.buildTime
            });

            // 保存索引到磁盘
            await this.saveIndex();

            return {
                totalLines: this.totalLines,
                buildTime: this.stats.buildTime
            };

        } catch (error) {
            this.isBuilding = false;
            this.buildLock = false;
            throw error;
        }
    }

    /**
     * 查询行偏移量 - O(log n) 复杂度
     */
    async getLineOffset(lineNum) {
        const startTime = process.hrtime.bigint();
        
        if (lineNum < 1 || lineNum > this.totalLines) {
            throw new Error(`行号超出范围: ${lineNum}`);
        }

        // 记录查询历史
        this.sparseStrategy.recordQuery(lineNum);

        // 计算块ID
        const blockId = Math.floor((lineNum - 1) / this.blockSize);
        const localLineNum = ((lineNum - 1) % this.blockSize) + 1;

        // 获取块
        const block = await this.pageManager.getBlock(blockId, async (id) => {
            // 块加载器 - 如果内存和磁盘都不存在，需要重新构建
            this.stats.cacheMisses++;
            return null;
        });

        if (!block) {
            throw new Error(`索引块不存在: ${blockId}`);
        }

        this.stats.cacheHits++;
        const offset = block.getOffset(localLineNum);

        // 更新统计
        this.stats.totalQueries++;
        const queryTime = Number(process.hrtime.bigint() - startTime) / 1000000;  // 转换为毫秒
        this.stats.avgQueryTime = (this.stats.avgQueryTime * (this.stats.totalQueries - 1) + queryTime) 
                                  / this.stats.totalQueries;

        return offset;
    }

    /**
     * 反向查找 - 根据偏移量查找行号 - O(log n) 复杂度
     */
    async getLineNumberByOffset(offset) {
        if (offset < 0 || offset > this.fileSize) {
            throw new Error(`偏移量超出范围: ${offset}`);
        }

        // 二分查找
        let left = 1;
        let right = this.totalLines;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const lineOffset = await this.getLineOffset(mid);

            if (lineOffset === offset) {
                return mid;
            } else if (lineOffset < offset) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        // 返回最接近的行号
        return right > 0 ? right : 1;
    }

    /**
     * 基于插值的快速定位
     */
    async interpolateLineNumber(targetOffset) {
        if (this.totalLines === 0) return 1;

        // 使用稀疏索引进行插值估算
        const estimatedLine = Math.floor((targetOffset / this.fileSize) * this.totalLines);
        const searchRange = Math.floor(this.totalLines * 0.01);  // 1%的搜索范围

        let left = Math.max(1, estimatedLine - searchRange);
        let right = Math.min(this.totalLines, estimatedLine + searchRange);

        // 在估算范围内二分查找
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const offset = await this.getLineOffset(mid);

            if (Math.abs(offset - targetOffset) < 100) {  // 允许100字节的误差
                return mid;
            } else if (offset < targetOffset) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        return right > 0 ? right : 1;
    }

    /**
     * 批量查询行偏移量
     */
    async getLineOffsets(startLine, endLine) {
        const results = [];
        
        for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
            try {
                const offset = await this.getLineOffset(lineNum);
                results.push({ lineNum, offset });
            } catch (error) {
                results.push({ lineNum, error: error.message });
            }
        }

        return results;
    }

    /**
     * 获取行长度
     */
    async getLineLength(lineNum) {
        const offset = await this.getLineOffset(lineNum);
        
        if (lineNum < this.totalLines) {
            const nextOffset = await this.getLineOffset(lineNum + 1);
            return nextOffset - offset;
        }
        
        return this.fileSize - offset;
    }

    /**
     * 暂停索引构建
     */
    pauseBuild() {
        this.isPaused = true;
        this.emit('build-paused');
    }

    /**
     * 恢复索引构建
     */
    resumeBuild() {
        this.isPaused = false;
        this.emit('build-resumed');
    }

    /**
     * 添加优先级任务
     */
    addPriorityTask(task) {
        this.buildQueue.push(task);
    }

    /**
     * 处理优先级任务
     */
    async handlePriorityTask(task) {
        // 处理高优先级查询任务
        if (task.type === 'query') {
            const result = await this.getLineOffset(task.lineNum);
            if (task.callback) {
                task.callback(result);
            }
        }
    }

    /**
     * 保存索引到磁盘
     */
    async saveIndex() {
        if (!this.pageManager.diskCachePath) return;

        const indexData = {
            version: 1,
            filePath: this.filePath,
            fileSize: this.fileSize,
            totalLines: this.totalLines,
            blockSize: this.blockSize,
            blocks: Array.from(this.blocks.entries()),
            stats: this.stats,
            timestamp: Date.now()
        };

        const indexPath = path.join(this.pageManager.diskCachePath, 'index.meta');
        await fs.promises.writeFile(indexPath, JSON.stringify(indexData, null, 2));
    }

    /**
     * 加载持久化的索引
     */
    async loadIndex() {
        if (!this.pageManager.diskCachePath) return false;

        try {
            const indexPath = path.join(this.pageManager.diskCachePath, 'index.meta');
            const data = await fs.promises.readFile(indexPath, 'utf8');
            const indexData = JSON.parse(data);

            // 验证索引是否匹配当前文件
            if (indexData.filePath !== this.filePath || 
                indexData.fileSize !== this.fileSize) {
                return false;
            }

            this.totalLines = indexData.totalLines;
            this.blocks = new Map(indexData.blocks);
            this.stats = indexData.stats || this.stats;

            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            ...this.stats,
            totalLines: this.totalLines,
            fileSize: this.fileSize,
            blockCount: this.blocks.size,
            memoryBlocks: this.pageManager.blocks.size,
            memoryUsage: this.pageManager.memoryUsage,
            buildProgress: this.buildProgress,
            isBuilding: this.isBuilding
        };
    }

    /**
     * 销毁索引管理器
     */
    async destroy() {
        this.pauseBuild();
        
        // 保存索引
        await this.saveIndex();

        // 清理资源
        this.blocks.clear();
        this.pageManager.blocks.clear();
        this.pageManager.lruQueue = [];
        this.removeAllListeners();
    }

    /**
     * 休眠辅助函数
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = {
    LineIndexManager,
    IndexBlock,
    SparseIndexStrategy,
    MemoryPageManager
};

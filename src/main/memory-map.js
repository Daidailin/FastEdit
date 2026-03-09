const koffi = require('koffi');
const path = require('path');
const fs = require('fs');
const { bufferToString } = require('./encoding-detector');

// 加载 kernel32.dll
const kernel32 = koffi.load('kernel32.dll');

// 定义 Windows API 函数
const CreateFileW = kernel32.func('CreateFileW', 'void *', ['void *', 'uint32', 'uint32', 'void *', 'uint32', 'uint32', 'void *']);
const CreateFileMappingW = kernel32.func('CreateFileMappingW', 'void *', ['void *', 'void *', 'uint32', 'uint32', 'uint32', 'void *']);
const MapViewOfFile = kernel32.func('MapViewOfFile', 'void *', ['void *', 'uint32', 'uint32', 'uint32', 'uint64']);
const UnmapViewOfFile = kernel32.func('UnmapViewOfFile', 'int', ['void *']);
const CloseHandle = kernel32.func('CloseHandle', 'int', ['void *']);
const GetFileSizeEx = kernel32.func('GetFileSizeEx', 'int', ['void *', 'void *']);
const GetLastError = kernel32.func('GetLastError', 'uint32', []);

const INVALID_HANDLE_VALUE = -1;
const PAGE_READONLY = 0x02;
const FILE_MAP_READ = 0x0004;
const ERROR_FILE_NOT_FOUND = 2;
const ERROR_ACCESS_DENIED = 5;
const ERROR_INVALID_HANDLE = 6;
const ERROR_NOT_ENOUGH_MEMORY = 8;

const WindowsError = {
    [ERROR_FILE_NOT_FOUND]: '找不到指定的文件',
    [ERROR_ACCESS_DENIED]: '访问被拒绝',
    [ERROR_INVALID_HANDLE]: '无效的文件句柄',
    [ERROR_NOT_ENOUGH_MEMORY]: '内存不足',
    1132: '用户句柄不足（句柄泄漏）',
};

function getLastErrorMessage(code) {
    return WindowsError[code] || `Windows 错误代码: ${code}`;
}

const GENERIC_READ = 0x80000000;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_WRITE = 0x00000002;
const FILE_SHARE_DELETE = 0x00000004;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x00000080;

class MemoryMappedFile {
    constructor() {
        this.fileHandle = null;
        this.mappingHandle = null;
        this.viewPtr = null;
        this.viewSize = 0;
        this.fileSize = 0;
        this.filePath = null;
        this.mappedOffset = 0;
        this.mappedSize = 0;
        // 使用 fs 读取作为后备方案
        this.fallbackFd = null;
        // 句柄使用计数，用于检测泄漏
        this.viewMapCount = 0;
        this.maxViewMaps = 1000; // 最大映射次数限制
        this.forceFallbackThreshold = 500; // 超过此阈值后强制使用后备读取
        this.forceFallback = false; // 强制使用后备读取标志
        this.smallReadThreshold = 64 * 1024; // 小于64KB的读取直接使用后备方案
        this.largeFileThreshold = 100 * 1024 * 1024; // 大文件阈值：100MB
        this.mappingSize = 0; // 记录创建映射时的大小
    }

    open(filePath) {
        try {
            this.filePath = filePath;
            
            // 打开文件句柄（用于内存映射）
            const widePath = Buffer.from(filePath + '\0', 'ucs2');
            
            this.fileHandle = CreateFileW(
                widePath,
                GENERIC_READ,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                null
            );

            if (!this.fileHandle) {
                const errorCode = GetLastError();
                throw new Error(`无法打开文件: ${getLastErrorMessage(errorCode)}`);
            }

            // 获取文件大小
            const sizeBuffer = Buffer.alloc(8);
            const result = GetFileSizeEx(this.fileHandle, sizeBuffer);
            
            if (!result) {
                const errorCode = GetLastError();
                this.close();
                throw new Error(`无法获取文件大小: ${getLastErrorMessage(errorCode)}`);
            }

            this.fileSize = sizeBuffer.readBigInt64LE(0);
            
            // 同时打开文件描述符（用于后备读取）
            try {
                this.fallbackFd = fs.openSync(filePath, 'r');
            } catch (e) {
                console.warn('无法打开后备文件描述符:', e.message);
            }
            
            return {
                success: true,
                fileSize: Number(this.fileSize)
            };
        } catch (error) {
            this.close();
            throw error;
        }
    }

    createMapping(maxSize = null) {
        try {
            if (!this.fileHandle) {
                throw new Error('文件未打开');
            }

            const maxMapSize = 256 * 1024 * 1024;
            const fileSizeNum = Number(this.fileSize);
            const sizeToMap = maxSize ? BigInt(maxSize) : 
                              (fileSizeNum <= maxMapSize ? this.fileSize : BigInt(maxMapSize));
            
            const sizeHigh = Number(sizeToMap >> BigInt(32));
            const sizeLow = Number(sizeToMap & BigInt(0xFFFFFFFF));

            this.mappingHandle = CreateFileMappingW(
                this.fileHandle,
                null,
                PAGE_READONLY,
                sizeHigh,
                sizeLow,
                null
            );

            if (!this.mappingHandle) {
                const errorCode = GetLastError();
                throw new Error(`无法创建文件映射: ${getLastErrorMessage(errorCode)}`);
            }

            // 记录映射大小，后续视图映射不能超过此大小
            this.mappingSize = Number(sizeToMap);

            // 对于大文件，直接强制使用后备读取模式
            if (fileSizeNum > this.largeFileThreshold) {
                console.log(`大文件检测: ${(fileSizeNum / 1024 / 1024).toFixed(2)} MB，将使用后备读取模式`);
                this.forceFallback = true;
            }

            return true;
        } catch (error) {
            throw error;
        }
    }

    mapView(offset, size) {
        try {
            if (!this.mappingHandle) {
                throw new Error('文件映射未创建');
            }

            // 检查映射次数限制
            this.viewMapCount++;
            if (this.viewMapCount > this.maxViewMaps) {
                throw new Error(`映射次数超过限制 (${this.maxViewMaps})，可能存在句柄泄漏`);
            }

            // 确保视图大小不超过映射大小
            const maxViewSize = this.mappingSize - offset;
            if (size > maxViewSize) {
                size = maxViewSize;
            }

            // 确保视图大小有效
            if (size <= 0) {
                throw new Error(`无效的视图大小: ${size}`);
            }

            this.unmapView();

            const offsetBig = BigInt(offset);
            const offsetHigh = Number(offsetBig >> BigInt(32));
            const offsetLow = Number(offsetBig & BigInt(0xFFFFFFFF));

            this.viewPtr = MapViewOfFile(
                this.mappingHandle,
                FILE_MAP_READ,
                offsetHigh,
                offsetLow,
                size
            );

            if (!this.viewPtr) {
                const errorCode = GetLastError();
                throw new Error(`无法映射视图: ${getLastErrorMessage(errorCode)}`);
            }

            this.mappedOffset = offset;
            this.mappedSize = size;

            return {
                ptr: this.viewPtr,
                offset: offset,
                size: size
            };
        } catch (error) {
            throw error;
        }
    }

    readBuffer(offset, length) {
        try {
            const fileSizeNum = Number(this.fileSize);
            if (offset + length > fileSizeNum) {
                length = fileSizeNum - offset;
            }

            if (length <= 0) {
                return Buffer.alloc(0);
            }

            // 小数据读取（小于64KB）直接使用后备方案，避免内存映射开销
            if (length < this.smallReadThreshold) {
                if (this.fallbackFd !== null) {
                    const buffer = Buffer.alloc(length);
                    const bytesRead = fs.readSync(this.fallbackFd, buffer, 0, length, offset);
                    if (bytesRead < length) {
                        return buffer.slice(0, bytesRead);
                    }
                    return buffer;
                }
            }

            // 如果设置了强制后备读取标志，直接使用后备方案
            if (this.forceFallback) {
                if (this.fallbackFd !== null) {
                    try {
                        const buffer = Buffer.alloc(length);
                        const bytesRead = fs.readSync(this.fallbackFd, buffer, 0, length, offset);
                        if (bytesRead < length) {
                            return buffer.slice(0, bytesRead);
                        }
                        return buffer;
                    } catch (readError) {
                        console.error('后备读取失败:', readError.message);
                        throw readError;
                    }
                } else {
                    console.error('强制后备模式但 fallbackFd 为 null');
                    throw new Error('后备文件描述符未打开');
                }
            }

            // 如果映射次数超过阈值，强制使用后备读取以避免句柄泄漏
            if (this.viewMapCount > this.forceFallbackThreshold) {
                console.warn(`映射次数超过阈值 (${this.forceFallbackThreshold})，切换到后备读取模式`);
                this.forceFallback = true; // 永久切换到后备模式
                if (this.fallbackFd !== null) {
                    const buffer = Buffer.alloc(length);
                    const bytesRead = fs.readSync(this.fallbackFd, buffer, 0, length, offset);
                    if (bytesRead < length) {
                        return buffer.slice(0, bytesRead);
                    }
                    return buffer;
                }
            }

            // 优先使用内存映射（如果视图已存在且范围合适）
            if (this.viewPtr && offset >= this.mappedOffset && offset + length <= this.mappedOffset + this.mappedSize) {
                // 使用 koffi 读取内存数据
                const relativeOffset = offset - this.mappedOffset;
                const ByteArray = koffi.array('uint8', length);
                const data = koffi.decode(this.viewPtr, ByteArray, relativeOffset);

                const buffer = Buffer.alloc(length);
                if (data && data.length > 0) {
                    for (let i = 0; i < Math.min(data.length, length); i++) {
                        buffer[i] = data[i];
                    }
                }
                return buffer;
            }

            // 尝试映射新视图
            try {
                const remainingSize = fileSizeNum - offset;
                const viewSize = Math.min(64 * 1024 * 1024, remainingSize);
                this.mapView(offset, viewSize);

                // 使用 koffi 读取内存数据
                const relativeOffset = 0; // 新视图的偏移量为0
                const ByteArray = koffi.array('uint8', length);
                const data = koffi.decode(this.viewPtr, ByteArray, relativeOffset);

                const buffer = Buffer.alloc(length);
                if (data && data.length > 0) {
                    for (let i = 0; i < Math.min(data.length, length); i++) {
                        buffer[i] = data[i];
                    }
                }
                return buffer;
            } catch (mapError) {
                // 内存映射失败，使用后备方案
                console.warn('内存映射失败，使用后备读取:', mapError.message);
            }

            // 使用 fs.readSync 作为后备方案读取文件
            if (this.fallbackFd !== null) {
                const buffer = Buffer.alloc(length);
                const bytesRead = fs.readSync(this.fallbackFd, buffer, 0, length, offset);
                if (bytesRead < length) {
                    return buffer.slice(0, bytesRead);
                }
                return buffer;
            }

            throw new Error('无法读取文件：内存映射和后备读取都失败');
        } catch (error) {
            throw new Error(`读取缓冲区失败: ${error.message}`);
        }
    }

    readString(offset, length, encoding = 'utf-8') {
        const buffer = this.readBuffer(offset, length);
        return buffer.toString(encoding);
    }

    unmapView() {
        if (this.viewPtr) {
            try {
                UnmapViewOfFile(this.viewPtr);
            } catch (e) {
                console.warn('解除视图映射时出错:', e.message);
            }
            this.viewPtr = null;
            this.mappedOffset = 0;
            this.mappedSize = 0;
        }
    }

    close() {
        this.unmapView();

        if (this.mappingHandle) {
            try {
                CloseHandle(this.mappingHandle);
            } catch (e) {
                console.warn('关闭映射句柄时出错:', e.message);
            }
            this.mappingHandle = null;
        }

        if (this.fileHandle) {
            try {
                CloseHandle(this.fileHandle);
            } catch (e) {
                console.warn('关闭文件句柄时出错:', e.message);
            }
            this.fileHandle = null;
        }
        
        if (this.fallbackFd !== null) {
            try {
                fs.closeSync(this.fallbackFd);
            } catch (e) {
                console.warn('关闭后备文件描述符时出错:', e.message);
            }
            this.fallbackFd = null;
        }

        this.fileSize = 0;
        this.filePath = null;
    }
}

class LineIndexBuilder {
    constructor(memoryMappedFile) {
        this.mmf = memoryMappedFile;
        this.lineOffsets = [0];
        // 减小分块大小以减少内存压力，特别是对于超大文件
        this.chunkSize = 8 * 1024 * 1024; // 8MB 分块
        this.maxOffsetsInMemory = 20000000; // 最大内存中保存的偏移量数量（2000万行）
        this.useDiskStorage = false; // 是否使用磁盘存储索引
        this.indexFilePath = null; // 索引文件路径
    }

    async buildIndex(progressCallback = null) {
        try {
            const fileSize = Number(this.mmf.fileSize);
            const totalChunks = Math.ceil(fileSize / this.chunkSize);
            let processedChunks = 0;

            // 对于大文件（超过256MB），使用流式处理
            if (fileSize > 256 * 1024 * 1024) { // 大于 256MB
                console.log(`大文件检测: ${(fileSize / 1024 / 1024).toFixed(2)} MB，使用流式索引构建`);
                return await this.buildIndexStreaming(fileSize, totalChunks, progressCallback);
            }

            for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                const chunkOffset = chunkIndex * this.chunkSize;
                const currentChunkSize = Math.min(this.chunkSize, fileSize - chunkOffset);

                const buffer = this.mmf.readBuffer(chunkOffset, currentChunkSize);

                for (let i = 0; i < buffer.length; i++) {
                    if (buffer[i] === 0x0A) {
                        this.lineOffsets.push(chunkOffset + i + 1);

                        // 检查内存限制
                        if (this.lineOffsets.length >= this.maxOffsetsInMemory) {
                            console.warn(`行数超过内存限制 (${this.maxOffsetsInMemory})，切换到稀疏索引模式`);
                            return this.buildSparseIndex(fileSize, chunkIndex, progressCallback);
                        }
                    }
                }

                processedChunks++;

                // 每处理10个分块让出时间片，避免阻塞
                if (chunkIndex % 10 === 0) {
                    if (progressCallback) {
                        const progress = Math.round(processedChunks / totalChunks * 50); // 前50%用于索引构建
                        progressCallback(progress, processedChunks, totalChunks);
                    }
                    // 使用 setImmediate 让出时间片
                    await new Promise(resolve => setImmediate(resolve));
                }
            }

            if (this.lineOffsets[this.lineOffsets.length - 1] >= fileSize && this.lineOffsets.length > 1) {
                this.lineOffsets.pop();
            }

            // 完成索引构建
            if (progressCallback) {
                progressCallback(100, totalChunks, totalChunks);
            }

            return {
                totalLines: this.lineOffsets.length,
                lineOffsets: this.lineOffsets,
                isSparse: false
            };
        } catch (error) {
            throw new Error(`构建行索引失败: ${error.message}`);
        }
    }

    /**
     * 流式索引构建 - 用于超大文件
     * 构建完整的行索引，但使用流式处理减少内存压力
     */
    async buildIndexStreaming(fileSize, totalChunks, progressCallback) {
        console.log(`开始流式索引构建，总分块数: ${totalChunks}`);
        
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const chunkOffset = chunkIndex * this.chunkSize;
            const currentChunkSize = Math.min(this.chunkSize, fileSize - chunkOffset);

            try {
                const buffer = this.mmf.readBuffer(chunkOffset, currentChunkSize);

                for (let i = 0; i < buffer.length; i++) {
                    if (buffer[i] === 0x0A) {
                        this.lineOffsets.push(chunkOffset + i + 1);

                        // 检查内存限制
                        if (this.lineOffsets.length >= this.maxOffsetsInMemory) {
                            console.warn(`行数超过内存限制 (${this.maxOffsetsInMemory})，切换到稀疏索引模式`);
                            return this.buildSparseIndex(fileSize, chunkIndex, progressCallback);
                        }
                    }
                }
            } catch (readError) {
                console.error(`读取分块 ${chunkIndex} 失败:`, readError.message);
                throw readError;
            }

            // 每处理10个分块报告进度并让出时间片
            if (chunkIndex % 10 === 0) {
                if (progressCallback) {
                    const progress = Math.round((chunkIndex + 1) / totalChunks * 50);
                    progressCallback(progress, chunkIndex + 1, totalChunks);
                }
                // 使用 setImmediate 让出时间片，避免阻塞
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        if (this.lineOffsets[this.lineOffsets.length - 1] >= fileSize && this.lineOffsets.length > 1) {
            this.lineOffsets.pop();
        }

        if (progressCallback) {
            progressCallback(100, totalChunks, totalChunks);
        }

        console.log(`流式索引构建完成，总行数: ${this.lineOffsets.length}`);

        return {
            totalLines: this.lineOffsets.length,
            lineOffsets: this.lineOffsets,
            isSparse: false
        };
    }

    /**
     * 稀疏索引模式 - 当行数超过内存限制时使用
     */
    buildSparseIndex(fileSize, currentChunkIndex, progressCallback) {
        // 保存已收集的偏移量
        const baseOffsets = [...this.lineOffsets];
        const samplingInterval = Math.max(100, Math.floor(baseOffsets.length / 1000)); // 每1000行采样一次

        // 清空并重新采样
        this.lineOffsets = [];
        for (let i = 0; i < baseOffsets.length; i += samplingInterval) {
            this.lineOffsets.push(baseOffsets[i]);
        }

        // 继续处理剩余分块，但只采样
        const totalChunks = Math.ceil(fileSize / this.chunkSize);

        for (let chunkIndex = currentChunkIndex + 1; chunkIndex < totalChunks; chunkIndex++) {
            const chunkOffset = chunkIndex * this.chunkSize;
            const currentChunkSize = Math.min(this.chunkSize, fileSize - chunkOffset);

            const buffer = this.mmf.readBuffer(chunkOffset, currentChunkSize);
            let lineCount = 0;

            for (let i = 0; i < buffer.length; i++) {
                if (buffer[i] === 0x0A) {
                    lineCount++;
                    if (lineCount % samplingInterval === 0) {
                        this.lineOffsets.push(chunkOffset + i + 1);
                    }
                }
            }

            if (chunkIndex % 10 === 0 && progressCallback) {
                const progress = 50 + Math.round((chunkIndex - currentChunkIndex) / (totalChunks - currentChunkIndex) * 50);
                progressCallback(progress, chunkIndex, totalChunks);
            }
        }

        if (progressCallback) {
            progressCallback(100, totalChunks, totalChunks);
        }

        return {
            totalLines: this.lineOffsets.length * samplingInterval, // 估算总行数
            lineOffsets: this.lineOffsets,
            isSparse: true,
            samplingInterval: samplingInterval
        };
    }

    getLineOffset(lineNumber) {
        if (lineNumber < 1 || lineNumber > this.lineOffsets.length) {
            throw new Error(`行号超出范围: ${lineNumber}`);
        }
        return this.lineOffsets[lineNumber - 1];
    }

    getLineLength(lineNumber) {
        const startOffset = this.getLineOffset(lineNumber);
        const endOffset = lineNumber < this.lineOffsets.length 
            ? this.lineOffsets[lineNumber] 
            : Number(this.mmf.fileSize);
        return endOffset - startOffset;
    }

    offsetToLine(offset) {
        let left = 0;
        let right = this.lineOffsets.length - 1;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (this.lineOffsets[mid] <= offset) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        return right + 1;
    }
}

class MemoryMappedFileManager {
    constructor() {
        this.mmf = new MemoryMappedFile();
        this.lineIndex = null;
        this.cache = new Map();
        this.maxCacheSize = 1000;
        this.encoding = 'UTF-8'; // 默认编码
    }

    /**
     * 设置文件编码
     * @param {string} encoding - 编码名称
     */
    setEncoding(encoding) {
        this.encoding = encoding;
        // 清空缓存，因为编码改变了
        this.clearCache();
    }

    /**
     * 获取当前编码
     * @returns {string} 当前编码
     */
    getEncoding() {
        return this.encoding;
    }

    async openFile(filePath, progressCallback = null) {
        try {
            const result = this.mmf.open(filePath);
            
            this.mmf.createMapping();
            
            const builder = new LineIndexBuilder(this.mmf);
            const indexResult = await builder.buildIndex(progressCallback);
            
            this.lineIndex = builder;
            
            return {
                success: true,
                fileSize: result.fileSize,
                totalLines: indexResult.totalLines
            };
        } catch (error) {
            this.close();
            throw error;
        }
    }

    readLine(lineNumber) {
        try {
            const cacheKey = `line_${lineNumber}_${this.encoding}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            const offset = this.lineIndex.getLineOffset(lineNumber);
            const length = this.lineIndex.getLineLength(lineNumber);
            
            const buffer = this.mmf.readBuffer(offset, length);
            
            // 使用编码检测模块转换缓冲区为字符串
            let content = bufferToString(buffer, this.encoding);
            content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            if (content.endsWith('\n')) {
                content = content.slice(0, -1);
            }

            this.addToCache(cacheKey, content);
            
            return content;
        } catch (error) {
            throw new Error(`读取第 ${lineNumber} 行失败: ${error.message}`);
        }
    }

    readLines(startLine, endLine) {
        const lines = [];
        for (let i = startLine; i <= endLine; i++) {
            try {
                const content = this.readLine(i);
                lines.push({ lineNum: i, content: content });
            } catch (error) {
                lines.push({ lineNum: i, content: '', error: error.message });
            }
        }
        return lines;
    }

    getLineCount() {
        return this.lineIndex ? this.lineIndex.lineOffsets.length : 0;
    }

    offsetToLine(offset) {
        return this.lineIndex ? this.lineIndex.offsetToLine(offset) : 1;
    }

    addToCache(key, value) {
        // 如果键已存在，先删除旧条目（LRU策略：最近访问的移到末尾）
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        
        // 如果缓存已满，删除最早的项
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(key, value);
    }

    clearCache() {
        this.cache.clear();
    }

    close() {
        this.clearCache();
        this.lineIndex = null;
        this.mmf.close();
    }
}

module.exports = {
    MemoryMappedFile,
    LineIndexBuilder,
    MemoryMappedFileManager,
    WindowsError,
    getLastErrorMessage
};

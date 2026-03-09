/**
 * 行索引管理器使用示例和测试
 */

const fs = require('fs');
const path = require('path');
const { LineIndexManager } = require('./line-index-manager');

/**
 * 示例1: 基本使用
 */
async function basicExample() {
    console.log('=== 基本使用示例 ===\n');

    const filePath = 'test.txt';
    const fileSize = fs.statSync(filePath).size;

    // 创建索引管理器
    const indexManager = new LineIndexManager({
        blockSize: 10000,  // 每10000行为一个块
        maxMemoryUsage: 100 * 1024 * 1024,  // 100MB内存限制
        diskCachePath: './index_cache',  // 磁盘缓存路径
        sparseOptions: {
            baseDensity: 1,  // 每行都建立索引
            adaptiveMode: true  // 启用自适应模式
        }
    });

    // 监听事件
    indexManager.on('build-progress', (data) => {
        console.log(`构建进度: ${(data.percent * 100).toFixed(2)}%, 已索引行数: ${data.lineCount}`);
    });

    indexManager.on('build-complete', (data) => {
        console.log(`索引构建完成! 总行数: ${data.totalLines}, 耗时: ${data.buildTime}ms`);
    });

    // 初始化
    await indexManager.initialize(filePath, fileSize);

    // 定义读取函数
    const readBufferFn = async (offset, length) => {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, offset);
        fs.closeSync(fd);
        return buffer;
    };

    // 构建索引
    const result = await indexManager.buildIndex(readBufferFn, {
        chunkSize: 1024 * 1024,  // 1MB分块
        onProgress: (progress) => {
            console.log(`进度: ${progress.percent}%, 已处理: ${progress.processedBytes}/${progress.totalBytes}字节`);
        }
    });

    console.log(`\n索引构建结果:`, result);

    // 查询行偏移量
    console.log('\n=== 查询测试 ===');
    const testLines = [1, 100, 1000, 10000, result.totalLines];
    
    for (const lineNum of testLines) {
        if (lineNum <= result.totalLines) {
            const startTime = Date.now();
            const offset = await indexManager.getLineOffset(lineNum);
            const queryTime = Date.now() - startTime;
            console.log(`行 ${lineNum} -> 偏移量 ${offset}, 查询耗时: ${queryTime}ms`);
        }
    }

    // 反向查找
    console.log('\n=== 反向查找测试 ===');
    const testOffsets = [0, 1000, 10000];
    
    for (const offset of testOffsets) {
        if (offset < fileSize) {
            const startTime = Date.now();
            const lineNum = await indexManager.getLineNumberByOffset(offset);
            const queryTime = Date.now() - startTime;
            console.log(`偏移量 ${offset} -> 行 ${lineNum}, 查询耗时: ${queryTime}ms`);
        }
    }

    // 获取统计信息
    console.log('\n=== 统计信息 ===');
    const stats = indexManager.getStats();
    console.log('总查询次数:', stats.totalQueries);
    console.log('缓存命中:', stats.cacheHits);
    console.log('缓存未命中:', stats.cacheMisses);
    console.log('平均查询时间:', stats.avgQueryTime.toFixed(3), 'ms');
    console.log('内存使用:', (stats.memoryUsage / 1024 / 1024).toFixed(2), 'MB');

    // 销毁
    await indexManager.destroy();
}

/**
 * 示例2: 大文件处理
 */
async function largeFileExample() {
    console.log('\n=== 大文件处理示例 ===\n');

    // 创建测试大文件
    const testFilePath = 'large_test.txt';
    const targetSize = 100 * 1024 * 1024;  // 100MB

    console.log('创建测试文件...');
    const writeStream = fs.createWriteStream(testFilePath);
    let written = 0;
    let lineNum = 0;

    while (written < targetSize) {
        const line = `这是第 ${++lineNum} 行测试数据，包含一些随机内容 ${Math.random()}\n`;
        writeStream.write(line);
        written += Buffer.byteLength(line);
    }
    writeStream.end();

    await new Promise((resolve) => writeStream.on('finish', resolve));

    const fileSize = fs.statSync(testFilePath).size;
    console.log(`测试文件创建完成: ${(fileSize / 1024 / 1024).toFixed(2)} MB, ${lineNum} 行\n`);

    // 创建索引管理器
    const indexManager = new LineIndexManager({
        blockSize: 50000,  // 每50000行为一个块
        maxMemoryUsage: 50 * 1024 * 1024,  // 50MB内存限制
        diskCachePath: './large_index_cache',
        sparseOptions: {
            baseDensity: 1,
            adaptiveMode: true
        }
    });

    let lastProgress = 0;
    indexManager.on('build-progress', (data) => {
        const percent = Math.floor(data.percent * 100);
        if (percent > lastProgress) {
            console.log(`构建进度: ${percent}%`);
            lastProgress = percent;
        }
    });

    await indexManager.initialize(testFilePath, fileSize);

    const readBufferFn = async (offset, length) => {
        const fd = fs.openSync(testFilePath, 'r');
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, offset);
        fs.closeSync(fd);
        return buffer;
    };

    const startTime = Date.now();
    const result = await indexManager.buildIndex(readBufferFn);
    const buildTime = Date.now() - startTime;

    console.log(`\n索引构建完成!`);
    console.log(`总行数: ${result.totalLines}`);
    console.log(`构建耗时: ${buildTime}ms`);
    console.log(`处理速度: ${(fileSize / 1024 / 1024 / (buildTime / 1000)).toFixed(2)} MB/s`);

    // 随机查询测试
    console.log('\n=== 随机查询性能测试 ===');
    const queryCount = 1000;
    const randomQueries = [];
    
    for (let i = 0; i < queryCount; i++) {
        randomQueries.push(Math.floor(Math.random() * result.totalLines) + 1);
    }

    const queryStartTime = Date.now();
    
    for (const lineNum of randomQueries) {
        await indexManager.getLineOffset(lineNum);
    }
    
    const queryTime = Date.now() - queryStartTime;
    const avgQueryTime = queryTime / queryCount;

    console.log(`查询次数: ${queryCount}`);
    console.log(`总查询时间: ${queryTime}ms`);
    console.log(`平均查询时间: ${avgQueryTime.toFixed(3)}ms`);
    console.log(`99%查询时间: ${(avgQueryTime * 2).toFixed(3)}ms (估算)`);

    // 统计信息
    const stats = indexManager.getStats();
    console.log('\n=== 内存使用 ===');
    console.log('内存块数:', stats.memoryBlocks);
    console.log('内存使用:', (stats.memoryUsage / 1024 / 1024).toFixed(2), 'MB');

    await indexManager.destroy();

    // 清理测试文件
    fs.unlinkSync(testFilePath);
    console.log('\n测试完成，已清理临时文件');
}

/**
 * 示例3: 并发查询测试
 */
async function concurrentQueryExample() {
    console.log('\n=== 并发查询测试 ===\n');

    // 创建测试文件
    const testFilePath = 'concurrent_test.txt';
    const lineCount = 100000;

    console.log('创建测试文件...');
    const lines = [];
    for (let i = 1; i <= lineCount; i++) {
        lines.push(`Line ${i}: ${'x'.repeat(Math.floor(Math.random() * 100))}\n`);
    }
    fs.writeFileSync(testFilePath, lines.join(''));

    const fileSize = fs.statSync(testFilePath).size;

    // 创建索引管理器
    const indexManager = new LineIndexManager({
        blockSize: 10000,
        maxMemoryUsage: 20 * 1024 * 1024,
        diskCachePath: './concurrent_index_cache'
    });

    await indexManager.initialize(testFilePath, fileSize);

    const readBufferFn = async (offset, length) => {
        const fd = fs.openSync(testFilePath, 'r');
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, offset);
        fs.closeSync(fd);
        return buffer;
    };

    await indexManager.buildIndex(readBufferFn);

    // 并发查询测试
    console.log('执行并发查询测试...');
    const concurrency = 10;
    const queriesPerWorker = 100;
    const workers = [];

    const workerFn = async (workerId) => {
        const results = [];
        for (let i = 0; i < queriesPerWorker; i++) {
            const lineNum = Math.floor(Math.random() * lineCount) + 1;
            const startTime = Date.now();
            const offset = await indexManager.getLineOffset(lineNum);
            results.push({
                workerId,
                lineNum,
                offset,
                queryTime: Date.now() - startTime
            });
        }
        return results;
    };

    const startTime = Date.now();

    for (let i = 0; i < concurrency; i++) {
        workers.push(workerFn(i));
    }

    const allResults = await Promise.all(workers);
    const totalTime = Date.now() - startTime;

    console.log(`\n并发查询结果:`);
    console.log(`工作线程数: ${concurrency}`);
    console.log(`每线程查询数: ${queriesPerWorker}`);
    console.log(`总查询数: ${concurrency * queriesPerWorker}`);
    console.log(`总耗时: ${totalTime}ms`);
    console.log(`平均查询时间: ${(totalTime / (concurrency * queriesPerWorker)).toFixed(3)}ms`);

    // 统计各线程的查询时间
    const allQueryTimes = allResults.flat().map(r => r.queryTime);
    const maxQueryTime = Math.max(...allQueryTimes);
    const minQueryTime = Math.min(...allQueryTimes);
    const avgQueryTime = allQueryTimes.reduce((a, b) => a + b, 0) / allQueryTimes.length;

    console.log(`\n查询时间统计:`);
    console.log(`最小: ${minQueryTime}ms`);
    console.log(`最大: ${maxQueryTime}ms`);
    console.log(`平均: ${avgQueryTime.toFixed(3)}ms`);

    await indexManager.destroy();
    fs.unlinkSync(testFilePath);
}

/**
 * 示例4: 索引持久化测试
 */
async function persistenceExample() {
    console.log('\n=== 索引持久化测试 ===\n');

    const testFilePath = 'persist_test.txt';
    const cachePath = './persist_index_cache';

    // 创建测试文件
    const lines = [];
    for (let i = 1; i <= 10000; i++) {
        lines.push(`Persistent line ${i}\n`);
    }
    fs.writeFileSync(testFilePath, lines.join(''));

    const fileSize = fs.statSync(testFilePath).size;

    // 第一次：构建并保存索引
    console.log('第一次：构建索引...');
    const indexManager1 = new LineIndexManager({
        blockSize: 1000,
        diskCachePath: cachePath
    });

    await indexManager1.initialize(testFilePath, fileSize);

    const readBufferFn = async (offset, length) => {
        const fd = fs.openSync(testFilePath, 'r');
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, offset);
        fs.closeSync(fd);
        return buffer;
    };

    const buildResult = await indexManager1.buildIndex(readBufferFn);
    console.log(`索引构建完成，总行数: ${buildResult.totalLines}`);

    // 查询一些数据
    const offset1 = await indexManager1.getLineOffset(5000);
    console.log(`行 5000 的偏移量: ${offset1}`);

    await indexManager1.destroy();

    // 第二次：加载持久化的索引
    console.log('\n第二次：加载持久化索引...');
    const indexManager2 = new LineIndexManager({
        blockSize: 1000,
        diskCachePath: cachePath
    });

    const loaded = await indexManager2.initialize(testFilePath, fileSize);
    console.log(`索引加载${loaded ? '成功' : '失败'}`);

    if (loaded) {
        const stats = indexManager2.getStats();
        console.log(`加载的索引信息:`);
        console.log(`总行数: ${stats.totalLines}`);
        console.log(`文件大小: ${stats.fileSize}`);

        // 验证查询
        const offset2 = await indexManager2.getLineOffset(5000);
        console.log(`行 5000 的偏移量: ${offset2}`);
        console.log(`偏移量匹配: ${offset1 === offset2 ? '是' : '否'}`);
    }

    await indexManager2.destroy();

    // 清理
    fs.unlinkSync(testFilePath);
    fs.rmSync(cachePath, { recursive: true, force: true });
    console.log('\n测试完成');
}

/**
 * 运行所有示例
 */
async function runAllExamples() {
    try {
        // 创建基本测试文件
        if (!fs.existsSync('test.txt')) {
            console.log('创建基本测试文件...');
            const lines = [];
            for (let i = 1; i <= 1000; i++) {
                lines.push(`Line ${i}: This is a test line with some content.\n`);
            }
            fs.writeFileSync('test.txt', lines.join(''));
        }

        await basicExample();
        await largeFileExample();
        await concurrentQueryExample();
        await persistenceExample();

        console.log('\n=== 所有示例运行完成 ===');

        // 清理
        if (fs.existsSync('test.txt')) {
            fs.unlinkSync('test.txt');
        }
        if (fs.existsSync('./index_cache')) {
            fs.rmSync('./index_cache', { recursive: true, force: true });
        }
        if (fs.existsSync('./large_index_cache')) {
            fs.rmSync('./large_index_cache', { recursive: true, force: true });
        }
        if (fs.existsSync('./concurrent_index_cache')) {
            fs.rmSync('./concurrent_index_cache', { recursive: true, force: true });
        }

    } catch (error) {
        console.error('运行示例时出错:', error);
    }
}

// 导出示例函数
module.exports = {
    basicExample,
    largeFileExample,
    concurrentQueryExample,
    persistenceExample,
    runAllExamples
};

// 如果直接运行此文件
if (require.main === module) {
    runAllExamples();
}

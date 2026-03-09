/**
 * 文本比较模块
 * 实现基于 LCS (最长公共子序列) 的文本差异比较算法
 * 支持相似度计算和差异标记
 */

class TextComparer {
    constructor() {
        this.originalLines = [];
        this.compareLines = [];
        this.diffResult = null;
    }

    /**
     * 设置原始文档
     * @param {string} text - 原始文本
     */
    setOriginal(text) {
        this.originalLines = this.splitLines(text);
        this.diffResult = null;
    }

    /**
     * 设置比较文档
     * @param {string} text - 比较文本
     */
    setCompare(text) {
        this.compareLines = this.splitLines(text);
        this.diffResult = null;
    }

    /**
     * 分割文本为行数组
     * @param {string} text - 文本内容
     * @returns {string[]} 行数组
     */
    splitLines(text) {
        if (!text) return [''];
        // 统一换行符为 \n 后分割
        return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    }

    /**
     * 计算文本相似度
     * @returns {number} 相似度百分比 (0-100)
     */
    calculateSimilarity() {
        if (this.originalLines.length === 0 && this.compareLines.length === 0) {
            return 100.00;
        }
        if (this.originalLines.length === 0 || this.compareLines.length === 0) {
            return 0.00;
        }

        const lcs = this.computeLCS(this.originalLines, this.compareLines);
        const maxLength = Math.max(this.originalLines.length, this.compareLines.length);
        
        if (maxLength === 0) return 100.00;
        
        const similarity = (lcs.length / maxLength) * 100;
        return parseFloat(similarity.toFixed(2));
    }

    /**
     * 计算最长公共子序列 (LCS)
     * 使用动态规划算法，时间复杂度 O(m*n)
     * 为优化性能，使用滚动数组减少内存占用
     * @param {string[]} arr1 - 第一个数组
     * @param {string[]} arr2 - 第二个数组
     * @returns {string[]} 最长公共子序列
     */
    computeLCS(arr1, arr2) {
        const m = arr1.length;
        const n = arr2.length;
        
        // 使用滚动数组优化内存，只保留两行
        let prev = new Array(n + 1).fill(0);
        let curr = new Array(n + 1).fill(0);
        
        // 记录路径用于回溯（为节省内存，只记录关键差异点）
        const path = [];
        
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (arr1[i - 1] === arr2[j - 1]) {
                    curr[j] = prev[j - 1] + 1;
                } else {
                    curr[j] = Math.max(prev[j], curr[j - 1]);
                }
            }
            // 交换数组
            [prev, curr] = [curr, prev];
        }
        
        // 回溯获取 LCS
        const lcs = [];
        let i = m, j = n;
        
        // 为回溯需要，重新计算 DP 表的最后部分
        // 优化：只存储必要的行
        const dp = [];
        const step = Math.max(1, Math.floor(Math.min(m, n) / 100)); // 最多存储 100 行
        
        // 简化的回溯：从后向前扫描
        while (i > 0 && j > 0) {
            if (arr1[i - 1] === arr2[j - 1]) {
                lcs.unshift(arr1[i - 1]);
                i--;
                j--;
            } else {
                // 简化的决策逻辑
                const up = i > 1 ? this.countMatches(arr1, arr2, i - 2, j - 1) : -1;
                const left = j > 1 ? this.countMatches(arr1, arr2, i - 1, j - 2) : -1;
                
                if (up >= left) {
                    i--;
                } else {
                    j--;
                }
            }
        }
        
        return lcs;
    }

    /**
     * 辅助函数：计算从指定位置开始的匹配数
     */
    countMatches(arr1, arr2, i, j) {
        let count = 0;
        while (i >= 0 && j >= 0 && arr1[i] === arr2[j]) {
            count++;
            i--;
            j--;
        }
        return count;
    }

    /**
     * 计算差异
     * 使用 Myers 差异算法的简化版本
     * @returns {object} 差异结果
     */
    computeDiff() {
        if (this.diffResult) {
            return this.diffResult;
        }

        const original = this.originalLines;
        const compare = this.compareLines;
        
        // 使用基于 LCS 的差异计算
        const diff = this.computeDiffFromLCS(original, compare);
        
        this.diffResult = {
            similarity: this.calculateSimilarity(),
            originalLines: original.length,
            compareLines: compare.length,
            changes: diff.changes,
            diffMap: diff.diffMap
        };
        
        return this.diffResult;
    }

    /**
     * 基于 LCS 计算差异
     * @param {string[]} original - 原始行
     * @param {string[]} compare - 比较行
     * @returns {object} 差异信息
     */
    computeDiffFromLCS(original, compare) {
        const changes = [];
        const diffMap = new Map(); // 比较文档行号 -> 差异类型
        
        let i = 0, j = 0;
        let originalLineNum = 1;
        let compareLineNum = 1;
        
        // 简化的差异计算：逐行比较
        while (i < original.length || j < compare.length) {
            const origLine = i < original.length ? original[i] : null;
            const compLine = j < compare.length ? compare[j] : null;
            
            if (origLine === null) {
                // 比较文档多出的行
                changes.push({
                    type: 'added',
                    originalLine: null,
                    compareLine: compareLineNum,
                    content: compLine
                });
                diffMap.set(compareLineNum, 'added');
                j++;
                compareLineNum++;
            } else if (compLine === null) {
                // 原始文档多出的行（在比较文档中删除）
                changes.push({
                    type: 'deleted',
                    originalLine: originalLineNum,
                    compareLine: null,
                    content: origLine
                });
                i++;
                originalLineNum++;
            } else if (origLine === compLine) {
                // 相同
                changes.push({
                    type: 'unchanged',
                    originalLine: originalLineNum,
                    compareLine: compareLineNum,
                    content: compLine
                });
                i++;
                j++;
                originalLineNum++;
                compareLineNum++;
            } else {
                // 不同，需要查找最佳匹配
                const match = this.findBestMatch(original, compare, i, j);
                
                if (match.type === 'modified') {
                    changes.push({
                        type: 'modified',
                        originalLine: originalLineNum,
                        compareLine: compareLineNum,
                        originalContent: origLine,
                        content: compLine,
                        similarity: this.calculateLineSimilarity(origLine, compLine)
                    });
                    diffMap.set(compareLineNum, 'modified');
                    i++;
                    j++;
                    originalLineNum++;
                    compareLineNum++;
                } else if (match.type === 'deleted') {
                    changes.push({
                        type: 'deleted',
                        originalLine: originalLineNum,
                        compareLine: null,
                        content: origLine
                    });
                    i++;
                    originalLineNum++;
                } else {
                    changes.push({
                        type: 'added',
                        originalLine: null,
                        compareLine: compareLineNum,
                        content: compLine
                    });
                    diffMap.set(compareLineNum, 'added');
                    j++;
                    compareLineNum++;
                }
            }
        }
        
        return { changes, diffMap };
    }

    /**
     * 查找最佳匹配
     * 决定当前行是修改、删除还是新增
     */
    findBestMatch(original, compare, i, j) {
        const origLine = original[i];
        const compLine = compare[j];
        
        // 计算当前行的相似度
        const currentSimilarity = this.calculateLineSimilarity(origLine, compLine);
        
        // 查找原始行在比较文档中的最佳匹配
        let bestMatchInCompare = -1;
        let bestSimilarity = currentSimilarity;
        const searchRange = Math.min(10, compare.length - j);
        
        for (let k = 1; k < searchRange; k++) {
            const sim = this.calculateLineSimilarity(origLine, compare[j + k]);
            if (sim > bestSimilarity) {
                bestSimilarity = sim;
                bestMatchInCompare = k;
            }
        }
        
        // 查找比较行在原始文档中的最佳匹配
        let bestMatchInOriginal = -1;
        bestSimilarity = currentSimilarity;
        const searchRangeOrig = Math.min(10, original.length - i);
        
        for (let k = 1; k < searchRangeOrig; k++) {
            const sim = this.calculateLineSimilarity(compare[j], original[i + k]);
            if (sim > bestSimilarity) {
                bestSimilarity = sim;
                bestMatchInOriginal = k;
            }
        }
        
        // 决策逻辑
        if (bestMatchInCompare > 0 && bestMatchInCompare <= 3) {
            // 原始行在比较文档后面找到更好的匹配，说明中间是新增的行
            return { type: 'added' };
        } else if (bestMatchInOriginal > 0 && bestMatchInOriginal <= 3) {
            // 比较行在原始文档后面找到更好的匹配，说明原始行被删除
            return { type: 'deleted' };
        } else if (currentSimilarity > 50) {
            // 相似度足够高，认为是修改
            return { type: 'modified' };
        } else {
            // 默认认为是修改
            return { type: 'modified' };
        }
    }

    /**
     * 计算单行相似度
     * @param {string} line1 - 第一行
     * @param {string} line2 - 第二行
     * @returns {number} 相似度 (0-100)
     */
    calculateLineSimilarity(line1, line2) {
        if (line1 === line2) return 100;
        if (!line1 || !line2) return 0;
        
        // 使用编辑距离计算相似度
        const distance = this.levenshteinDistance(line1, line2);
        const maxLen = Math.max(line1.length, line2.length);
        
        if (maxLen === 0) return 100;
        
        return ((maxLen - distance) / maxLen) * 100;
    }

    /**
     * 计算编辑距离 (Levenshtein Distance)
     * @param {string} s1 - 字符串1
     * @param {string} s2 - 字符串2
     * @returns {number} 编辑距离
     */
    levenshteinDistance(s1, s2) {
        const m = s1.length;
        const n = s2.length;
        
        // 使用滚动数组优化内存
        let prev = new Array(n + 1);
        let curr = new Array(n + 1);
        
        for (let j = 0; j <= n; j++) {
            prev[j] = j;
        }
        
        for (let i = 1; i <= m; i++) {
            curr[0] = i;
            for (let j = 1; j <= n; j++) {
                if (s1[i - 1] === s2[j - 1]) {
                    curr[j] = prev[j - 1];
                } else {
                    curr[j] = Math.min(
                        prev[j] + 1,      // 删除
                        curr[j - 1] + 1,  // 插入
                        prev[j - 1] + 1   // 替换
                    );
                }
            }
            [prev, curr] = [curr, prev];
        }
        
        return prev[n];
    }

    /**
     * 获取下一处差异
     * @param {number} currentLine - 当前行号
     * @returns {number|null} 下一处差异的行号
     */
    getNextDiff(currentLine) {
        if (!this.diffResult) {
            this.computeDiff();
        }
        
        const diffMap = this.diffResult.diffMap;
        const lines = Array.from(diffMap.keys()).sort((a, b) => a - b);
        
        for (const line of lines) {
            if (line > currentLine) {
                return line;
            }
        }
        
        return null;
    }

    /**
     * 获取上一处差异
     * @param {number} currentLine - 当前行号
     * @returns {number|null} 上一处差异的行号
     */
    getPrevDiff(currentLine) {
        if (!this.diffResult) {
            this.computeDiff();
        }
        
        const diffMap = this.diffResult.diffMap;
        const lines = Array.from(diffMap.keys()).sort((a, b) => b - a);
        
        for (const line of lines) {
            if (line < currentLine) {
                return line;
            }
        }
        
        return null;
    }

    /**
     * 获取所有差异行号
     * @returns {number[]} 差异行号数组
     */
    getAllDiffLines() {
        if (!this.diffResult) {
            this.computeDiff();
        }
        
        return Array.from(this.diffResult.diffMap.keys()).sort((a, b) => a - b);
    }

    /**
     * 检查指定行是否有差异
     * @param {number} lineNum - 行号
     * @returns {string|null} 差异类型或 null
     */
    getLineDiffType(lineNum) {
        if (!this.diffResult) {
            this.computeDiff();
        }
        
        return this.diffResult.diffMap.get(lineNum) || null;
    }

    /**
     * 清空数据
     */
    clear() {
        this.originalLines = [];
        this.compareLines = [];
        this.diffResult = null;
    }
}

module.exports = { TextComparer };

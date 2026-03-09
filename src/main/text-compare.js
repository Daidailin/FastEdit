/**
 * 文本比较模块
 * 优化版本：支持大文件分级比较策略
 */

class TextComparer {
    constructor() {
        this.originalLines = [];
        this.compareLines = [];
        this.diffResult = null;

        // 比较模式阈值
        this.THRESHOLDS = {
            SMALL_FILE: 1000,      // 小文件：精确比较
            MEDIUM_FILE: 10000,    // 中文件：仅行级比较
            LARGE_FILE: 50000      // 大文件：简化模式
        };
    }

    setOriginal(text) {
        this.originalLines = this.splitLines(text);
        this.diffResult = null;
    }

    setCompare(text) {
        this.compareLines = this.splitLines(text);
        this.diffResult = null;
    }

    splitLines(text) {
        if (!text) return [''];
        return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    }

    /**
     * 根据文件大小选择比较模式
     */
    getCompareMode() {
        const maxLines = Math.max(this.originalLines.length, this.compareLines.length);

        if (maxLines <= this.THRESHOLDS.SMALL_FILE) {
            return 'precise';      // 精确模式：全量 LCS + 字符级相似度
        } else if (maxLines <= this.THRESHOLDS.MEDIUM_FILE) {
            return 'line';         // 行级模式：不做字符级相似度
        } else if (maxLines <= this.THRESHOLDS.LARGE_FILE) {
            return 'simplified';   // 简化模式：仅差异位置
        } else {
            return 'navigation';   // 导航模式：仅差异导航
        }
    }

    /**
     * 计算文本相似度
     */
    calculateSimilarity() {
        const mode = this.getCompareMode();

        if (mode === 'precise') {
            // 小文件：使用 LCS 计算精确相似度
            return this.calculateSimilarityPrecise();
        } else {
            // 大文件：使用轻量估算
            return this.calculateSimilarityEstimate();
        }
    }

    /**
     * 精确相似度计算（小文件）
     */
    calculateSimilarityPrecise() {
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
     * 轻量相似度估算（大文件）
     * 使用抽样和哈希快速估算
     */
    calculateSimilarityEstimate() {
        if (this.originalLines.length === 0 && this.compareLines.length === 0) {
            return 100.00;
        }
        if (this.originalLines.length === 0 || this.compareLines.length === 0) {
            return 0.00;
        }

        // 方法1：相同行比例
        const originalSet = new Set(this.originalLines);
        const compareSet = new Set(this.compareLines);

        let matchCount = 0;
        for (const line of originalSet) {
            if (compareSet.has(line)) {
                matchCount++;
            }
        }

        const uniqueSimilarity = (matchCount / Math.max(originalSet.size, compareSet.size)) * 100;

        // 方法2：抽样比较（最多抽样 1000 行）
        const sampleSize = Math.min(1000, Math.min(this.originalLines.length, this.compareLines.length));
        const step = Math.max(1, Math.floor(Math.min(this.originalLines.length, this.compareLines.length) / sampleSize));

        let sampleMatches = 0;
        let sampleTotal = 0;

        for (let i = 0; i < Math.min(this.originalLines.length, this.compareLines.length); i += step) {
            if (this.originalLines[i] === this.compareLines[i]) {
                sampleMatches++;
            }
            sampleTotal++;
        }

        const sampleSimilarity = sampleTotal > 0 ? (sampleMatches / sampleTotal) * 100 : 0;

        // 综合估算（加权平均）
        const estimatedSimilarity = uniqueSimilarity * 0.4 + sampleSimilarity * 0.6;

        return parseFloat(estimatedSimilarity.toFixed(2));
    }

    /**
     * 计算 LCS（仅用于小文件）
     */
    computeLCS(arr1, arr2) {
        const m = arr1.length;
        const n = arr2.length;

        let prev = new Array(n + 1).fill(0);
        let curr = new Array(n + 1).fill(0);

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (arr1[i - 1] === arr2[j - 1]) {
                    curr[j] = prev[j - 1] + 1;
                } else {
                    curr[j] = Math.max(prev[j], curr[j - 1]);
                }
            }
            [prev, curr] = [curr, prev];
        }

        // 回溯获取 LCS
        const lcs = [];
        let i = m, j = n;

        while (i > 0 && j > 0) {
            if (arr1[i - 1] === arr2[j - 1]) {
                lcs.unshift(arr1[i - 1]);
                i--;
                j--;
            } else {
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
     */
    computeDiff() {
        if (this.diffResult) {
            return this.diffResult;
        }

        const mode = this.getCompareMode();
        let diff;

        switch (mode) {
            case 'precise':
                diff = this.computeDiffPrecise();
                break;
            case 'line':
                diff = this.computeDiffLine();
                break;
            case 'simplified':
            case 'navigation':
                diff = this.computeDiffSimplified();
                break;
            default:
                diff = this.computeDiffSimplified();
        }

        this.diffResult = {
            similarity: this.calculateSimilarity(),
            originalLines: this.originalLines.length,
            compareLines: this.compareLines.length,
            changes: diff.changes,
            diffMap: diff.diffMap,
            diffLines: diff.diffLines,
            mode: mode
        };

        return this.diffResult;
    }

    /**
     * 精确差异计算（小文件）
     */
    computeDiffPrecise() {
        const diffMap = new Map();
        const diffLines = [];
        const changes = [];

        let i = 0, j = 0;
        let originalLineNum = 1;
        let compareLineNum = 1;

        while (i < this.originalLines.length || j < this.compareLines.length) {
            const origLine = i < this.originalLines.length ? this.originalLines[i] : null;
            const compLine = j < this.compareLines.length ? this.compareLines[j] : null;

            if (origLine === null) {
                diffMap.set(compareLineNum, 'added');
                diffLines.push(compareLineNum);
                changes.push({ type: 'added', compareLine: compareLineNum, content: compLine });
                j++;
                compareLineNum++;
            } else if (compLine === null) {
                changes.push({ type: 'deleted', originalLine: originalLineNum, content: origLine });
                i++;
                originalLineNum++;
            } else if (origLine === compLine) {
                changes.push({ type: 'unchanged', originalLine: originalLineNum, compareLine: compareLineNum });
                i++;
                j++;
                originalLineNum++;
                compareLineNum++;
            } else {
                const match = this.findBestMatch(i, j);

                if (match.type === 'modified') {
                    diffMap.set(compareLineNum, 'modified');
                    diffLines.push(compareLineNum);
                    changes.push({
                        type: 'modified',
                        originalLine: originalLineNum,
                        compareLine: compareLineNum,
                        similarity: match.similarity
                    });
                    i++;
                    j++;
                    originalLineNum++;
                    compareLineNum++;
                } else if (match.type === 'deleted') {
                    changes.push({ type: 'deleted', originalLine: originalLineNum, content: origLine });
                    i++;
                    originalLineNum++;
                } else {
                    diffMap.set(compareLineNum, 'added');
                    diffLines.push(compareLineNum);
                    changes.push({ type: 'added', compareLine: compareLineNum, content: compLine });
                    j++;
                    compareLineNum++;
                }
            }
        }

        return { diffMap, diffLines, changes };
    }

    /**
     * 行级差异计算（中文件）
     * 不做字符级相似度
     */
    computeDiffLine() {
        const diffMap = new Map();
        const diffLines = [];

        let i = 0, j = 0;
        let compareLineNum = 1;

        while (i < this.originalLines.length || j < this.compareLines.length) {
            const origLine = i < this.originalLines.length ? this.originalLines[i] : null;
            const compLine = j < this.compareLines.length ? this.compareLines[j] : null;

            if (origLine === null) {
                diffMap.set(compareLineNum, 'added');
                diffLines.push(compareLineNum);
                j++;
                compareLineNum++;
            } else if (compLine === null) {
                i++;
            } else if (origLine === compLine) {
                i++;
                j++;
                compareLineNum++;
            } else {
                // 简化判断：只在前后 3 行内查找
                const foundInCompare = this.findLineInRange(this.compareLines, j + 1, j + 3, origLine);
                const foundInOriginal = this.findLineInRange(this.originalLines, i + 1, i + 3, compLine);

                if (foundInCompare !== -1) {
                    // 原始行在比较文档后面找到，中间是新增
                    for (let k = j; k < foundInCompare; k++) {
                        diffMap.set(compareLineNum, 'added');
                        diffLines.push(compareLineNum);
                        compareLineNum++;
                    }
                    j = foundInCompare;
                } else if (foundInOriginal !== -1) {
                    // 比较行在原始文档后面找到，原始行被删除
                    i = foundInOriginal;
                } else {
                    // 认为是修改
                    diffMap.set(compareLineNum, 'modified');
                    diffLines.push(compareLineNum);
                    i++;
                    j++;
                    compareLineNum++;
                }
            }
        }

        return { diffMap, diffLines, changes: [] };
    }

    /**
     * 简化差异计算（大文件）
     * 仅输出差异位置，不求完美对齐
     */
    computeDiffSimplified() {
        const diffMap = new Map();
        const diffLines = [];

        const minLen = Math.min(this.originalLines.length, this.compareLines.length);

        // 快速扫描：只比较对应位置
        for (let i = 0; i < minLen; i++) {
            if (this.originalLines[i] !== this.compareLines[i]) {
                const compareLineNum = i + 1;
                diffMap.set(compareLineNum, 'modified');
                diffLines.push(compareLineNum);
            }
        }

        // 处理长度差异
        if (this.compareLines.length > this.originalLines.length) {
            for (let i = this.originalLines.length; i < this.compareLines.length; i++) {
                const compareLineNum = i + 1;
                diffMap.set(compareLineNum, 'added');
                diffLines.push(compareLineNum);
            }
        }

        return { diffMap, diffLines, changes: [] };
    }

    /**
     * 在范围内查找行
     */
    findLineInRange(lines, start, end, target) {
        const actualEnd = Math.min(end, lines.length);
        for (let i = start; i < actualEnd; i++) {
            if (lines[i] === target) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 查找最佳匹配（仅用于精确模式）
     */
    findBestMatch(i, j) {
        const origLine = this.originalLines[i];
        const compLine = this.compareLines[j];

        // 快速判断
        if (origLine === compLine) {
            return { type: 'unchanged' };
        }

        // 长度差异过大，不太可能是修改
        const lenDiff = Math.abs(origLine.length - compLine.length);
        const maxLen = Math.max(origLine.length, compLine.length);
        if (maxLen > 0 && lenDiff / maxLen > 0.5) {
            // 长度差异超过 50%，先检查是否是新增/删除
            const foundInCompare = this.findLineInRange(this.compareLines, j + 1, j + 5, origLine);
            if (foundInCompare !== -1) {
                return { type: 'added' };
            }

            const foundInOriginal = this.findLineInRange(this.originalLines, i + 1, i + 5, compLine);
            if (foundInOriginal !== -1) {
                return { type: 'deleted' };
            }
        }

        // 计算相似度（仅在必要时）
        const similarity = this.calculateLineSimilarity(origLine, compLine);

        if (similarity > 50) {
            return { type: 'modified', similarity };
        }

        // 低相似度，检查是否是新增/删除
        const foundInCompare = this.findLineInRange(this.compareLines, j + 1, j + 3, origLine);
        if (foundInCompare !== -1) {
            return { type: 'added' };
        }

        const foundInOriginal = this.findLineInRange(this.originalLines, i + 1, i + 3, compLine);
        if (foundInOriginal !== -1) {
            return { type: 'deleted' };
        }

        return { type: 'modified', similarity };
    }

    /**
     * 计算单行相似度
     */
    calculateLineSimilarity(line1, line2) {
        if (line1 === line2) return 100;
        if (!line1 || !line2) return 0;

        // 快速判断：前缀/后缀
        if (line1[0] === line2[0] || line1[line1.length - 1] === line2[line2.length - 1]) {
            // 有共同边界，可能相似
        }

        // 使用编辑距离
        const distance = this.levenshteinDistance(line1, line2);
        const maxLen = Math.max(line1.length, line2.length);

        if (maxLen === 0) return 100;

        return ((maxLen - distance) / maxLen) * 100;
    }

    /**
     * 编辑距离
     */
    levenshteinDistance(s1, s2) {
        const m = s1.length;
        const n = s2.length;

        // 短字符串优化
        if (m === 0) return n;
        if (n === 0) return m;

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
                        prev[j] + 1,
                        curr[j - 1] + 1,
                        prev[j - 1] + 1
                    );
                }
            }
            [prev, curr] = [curr, prev];
        }

        return prev[n];
    }

    getNextDiff(currentLine) {
        if (!this.diffResult) {
            this.computeDiff();
        }

        const lines = this.diffResult.diffLines;
        for (const line of lines) {
            if (line > currentLine) {
                return line;
            }
        }

        return null;
    }

    getPrevDiff(currentLine) {
        if (!this.diffResult) {
            this.computeDiff();
        }

        const lines = [...this.diffResult.diffLines].reverse();
        for (const line of lines) {
            if (line < currentLine) {
                return line;
            }
        }

        return null;
    }

    getAllDiffLines() {
        if (!this.diffResult) {
            this.computeDiff();
        }

        return this.diffResult.diffLines;
    }

    getLineDiffType(lineNum) {
        if (!this.diffResult) {
            this.computeDiff();
        }

        return this.diffResult.diffMap.get(lineNum) || null;
    }

    clear() {
        this.originalLines = [];
        this.compareLines = [];
        this.diffResult = null;
    }
}

module.exports = { TextComparer };

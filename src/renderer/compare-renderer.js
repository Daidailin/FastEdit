/**
 * 文本比较界面渲染器
 * 处理比较界面的交互和显示
 * 使用虚拟滚动优化大文件性能
 */

import { CompareEditor } from './compare-virtual-scroll.js';

class CompareRenderer {
    constructor() {
        this.originalText = '';
        this.compareText = '';
        this.diffLines = [];
        this.currentDiffIndex = -1;
        this.isComparing = false;
        this.originalEditor = null;
        this.compareEditor = null;

        this.initElements();
        this.initEditors();
        this.initEventListeners();
        this.initIPC();
    }

    initElements() {
        // 按钮元素
        this.btnLoadOriginal = document.getElementById('btn-load-original');
        this.btnPasteOriginal = document.getElementById('btn-paste-original');
        this.btnLoadCompare = document.getElementById('btn-load-compare');
        this.btnPasteCompare = document.getElementById('btn-paste-compare');
        this.btnCompare = document.getElementById('btn-compare');
        this.btnClear = document.getElementById('btn-clear');
        this.btnClose = document.getElementById('btn-close');
        this.btnPrevDiff = document.getElementById('btn-prev-diff');
        this.btnNextDiff = document.getElementById('btn-next-diff');

        // 文件输入
        this.fileInputOriginal = document.getElementById('file-input-original');
        this.fileInputCompare = document.getElementById('file-input-compare');

        // 信息显示
        this.originalInfo = document.getElementById('original-info');
        this.compareInfo = document.getElementById('compare-info');
        this.similarityValue = document.getElementById('similarity-value');
        this.similarityProgress = document.getElementById('similarity-progress');

        // 行号容器
        this.originalLineNumbers = document.getElementById('original-line-numbers');
        this.compareLineNumbers = document.getElementById('compare-line-numbers');

        // 大文件警告
        this.originalWarning = document.getElementById('original-warning');
        this.compareWarning = document.getElementById('compare-warning');
    }

    initEditors() {
        // 创建虚拟滚动编辑器
        this.originalEditor = new CompareEditor('original-editor', {
            itemHeight: 22
        });

        this.compareEditor = new CompareEditor('compare-editor', {
            itemHeight: 22
        });

        // 设置滚动同步
        this.originalEditor.virtualScroll.onScroll = (scrollTop) => {
            this.syncScroll('original');
        };

        this.compareEditor.virtualScroll.onScroll = (scrollTop) => {
            this.syncScroll('compare');
        };
    }

    initEventListeners() {
        // 文件导入按钮
        this.btnLoadOriginal.addEventListener('click', () => {
            this.fileInputOriginal.click();
        });

        this.btnLoadCompare.addEventListener('click', () => {
            this.fileInputCompare.click();
        });

        // 文件选择事件
        this.fileInputOriginal.addEventListener('change', (e) => {
            this.loadFile(e.target.files[0], 'original');
        });

        this.fileInputCompare.addEventListener('change', (e) => {
            this.loadFile(e.target.files[0], 'compare');
        });

        // 粘贴按钮
        this.btnPasteOriginal.addEventListener('click', () => {
            this.pasteText('original');
        });

        this.btnPasteCompare.addEventListener('click', () => {
            this.pasteText('compare');
        });

        // 主要操作按钮
        this.btnCompare.addEventListener('click', () => this.performCompare());
        this.btnClear.addEventListener('click', () => this.clearAll());
        this.btnClose.addEventListener('click', () => this.closeWindow());

        // 差异导航
        this.btnPrevDiff.addEventListener('click', () => this.navigateToPrevDiff());
        this.btnNextDiff.addEventListener('click', () => this.navigateToNextDiff());

        // 监听行号容器滚动（防止用户直接滚动行号区域）
        this.originalLineNumbers.addEventListener('scroll', (e) => {
            e.preventDefault();
            this.syncScroll('original');
        });

        this.compareLineNumbers.addEventListener('scroll', (e) => {
            e.preventDefault();
            this.syncScroll('compare');
        });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'Enter':
                        e.preventDefault();
                        this.performCompare();
                        break;
                    case 'w':
                        e.preventDefault();
                        this.closeWindow();
                        break;
                }
            }
        });
    }

    initIPC() {
        // 监听来自主进程的消息
        if (window.electronAPI) {
            window.electronAPI.onCompareData((data) => {
                if (data.original) {
                    this.setOriginalText(data.original);
                }
                if (data.compare) {
                    this.setCompareText(data.compare);
                }
                if (data.autoCompare) {
                    this.performCompare();
                }
            });
        }
    }

    /**
     * 设置原始文档文本
     */
    setOriginalText(text) {
        // 限制大文件
        const MAX_LINES = 10000;
        const lines = text.split('\n');

        if (lines.length > MAX_LINES) {
            this.originalText = lines.slice(0, MAX_LINES).join('\n');
            this.originalWarning.classList.add('visible');
        } else {
            this.originalText = text;
            this.originalWarning.classList.remove('visible');
        }

        this.originalEditor.setText(this.originalText);
        this.updateLineInfo('original');
        this.updateLineNumbers('original');
        this.clearCompareResult();
    }

    /**
     * 设置比较文档文本
     */
    setCompareText(text) {
        // 限制大文件
        const MAX_LINES = 10000;
        const lines = text.split('\n');

        if (lines.length > MAX_LINES) {
            this.compareText = lines.slice(0, MAX_LINES).join('\n');
            this.compareWarning.classList.add('visible');
        } else {
            this.compareText = text;
            this.compareWarning.classList.remove('visible');
        }

        this.compareEditor.setText(this.compareText);
        this.updateLineInfo('compare');
        this.updateLineNumbers('compare');
        this.clearCompareResult();
    }

    /**
     * 加载文件
     */
    async loadFile(file, target) {
        if (!file) return;

        // 检查文件大小，如果太大则提示用户
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        if (file.size > MAX_FILE_SIZE) {
            const shouldContinue = confirm(
                `文件较大（${this.formatFileSize(file.size)}），加载可能需要较长时间。\n` +
                `建议只比较部分内容。\n\n是否继续加载？`
            );
            if (!shouldContinue) {
                return;
            }
        }

        try {
            const text = await this.readFile(file);
            if (target === 'original') {
                this.setOriginalText(text);
            } else {
                this.setCompareText(text);
            }
        } catch (error) {
            console.error('读取文件失败:', error);
            alert('读取文件失败: ' + error.message);
        }
    }

    /**
     * 格式化文件大小
     */
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    /**
     * 读取文件内容
     */
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    }

    /**
     * 粘贴文本
     */
    async pasteText(target) {
        try {
            const text = await navigator.clipboard.readText();
            if (target === 'original') {
                this.setOriginalText(text);
            } else {
                this.setCompareText(text);
            }
        } catch (error) {
            console.error('粘贴失败:', error);
            alert('无法访问剪贴板，请手动粘贴');
        }
    }

    /**
     * 更新行数信息
     */
    updateLineInfo(target) {
        const lineCount = target === 'original'
            ? this.originalEditor.getLineCount()
            : this.compareEditor.getLineCount();
        const infoEl = target === 'original' ? this.originalInfo : this.compareInfo;
        infoEl.textContent = `${lineCount} 行`;
    }

    /**
     * 更新行号显示
     */
    updateLineNumbers(target) {
        const editor = target === 'original' ? this.originalEditor : this.compareEditor;
        const lineNumbersEl = target === 'original' ? this.originalLineNumbers : this.compareLineNumbers;
        const lineCount = editor.getLineCount();

        const lineNumbersContent = lineNumbersEl.querySelector('.line-numbers-content');
        lineNumbersContent.innerHTML = '';

        for (let i = 1; i <= lineCount; i++) {
            const lineEl = document.createElement('div');
            lineEl.className = 'line';
            lineEl.textContent = i;
            lineNumbersContent.appendChild(lineEl);
        }

        // 同步滚动位置
        this.syncScroll(target);
    }

    /**
     * 清除比较结果
     */
    clearCompareResult() {
        this.updateSimilarity(0);
        this.diffLines = [];
        this.currentDiffIndex = -1;
        this.originalEditor.setDiffMap(new Map());
        this.compareEditor.setDiffMap(new Map());
        this.updateNavigationButtons();
    }

    /**
     * 执行比较
     */
    async performCompare() {
        this.originalText = this.originalEditor.getText();
        this.compareText = this.compareEditor.getText();

        if (!this.originalText && !this.compareText) {
            this.updateSimilarity(0);
            return;
        }

        // 检查文件大小，如果太大则提示用户
        const originalLines = this.originalText.split('\n').length;
        const compareLines = this.compareText.split('\n').length;
        const MAX_LINES = 10000;

        if (originalLines > MAX_LINES || compareLines > MAX_LINES) {
            const shouldContinue = confirm(
                `文档较大（${Math.max(originalLines, compareLines)} 行），比较可能需要较长时间。\n` +
                `建议只比较部分内容，或使用其他专业比较工具。\n\n` +
                `是否继续比较？`
            );
            if (!shouldContinue) {
                return;
            }
        }

        this.isComparing = true;
        this.btnCompare.disabled = true;
        this.btnCompare.textContent = '比较中...';

        // 使用 requestAnimationFrame 让 UI 先更新
        await new Promise(resolve => requestAnimationFrame(resolve));

        try {
            // 使用主进程的比较功能
            const result = await window.electronAPI.compareTexts({
                original: this.originalText,
                compare: this.compareText
            });

            this.updateSimilarity(result.similarity);
            this.diffLines = result.diffLines || [];
            this.highlightDifferences(result.diffMap);
            this.updateNavigationButtons();

        } catch (error) {
            console.error('比较失败:', error);
            alert('比较失败: ' + error.message);
        } finally {
            this.isComparing = false;
            this.btnCompare.disabled = false;
            this.btnCompare.textContent = '开始比较';
        }
    }

    /**
     * 更新相似度显示
     */
    updateSimilarity(similarity) {
        this.similarityValue.textContent = similarity.toFixed(2) + '%';
        this.similarityProgress.style.width = similarity + '%';

        // 根据相似度改变颜色
        const value = parseFloat(similarity);
        if (value >= 80) {
            this.similarityValue.style.color = '#4ec9b0'; // 绿色
        } else if (value >= 50) {
            this.similarityValue.style.color = '#dcdcaa'; // 黄色
        } else {
            this.similarityValue.style.color = '#f48771'; // 红色
        }
    }

    /**
     * 高亮差异
     */
    highlightDifferences(diffMap) {
        // 创建差异映射
        const diffMapObj = new Map();
        for (const [key, value] of Object.entries(diffMap)) {
            diffMapObj.set(parseInt(key), value);
        }

        // 应用到比较编辑器
        this.compareEditor.setDiffMap(diffMapObj);
    }

    /**
     * 更新导航按钮状态
     */
    updateNavigationButtons() {
        const hasDiffs = this.diffLines.length > 0;
        this.btnPrevDiff.disabled = !hasDiffs;
        this.btnNextDiff.disabled = !hasDiffs;

        if (hasDiffs) {
            this.currentDiffIndex = -1;
        }
    }

    /**
     * 导航到下一处差异
     */
    navigateToNextDiff() {
        if (this.diffLines.length === 0) return;

        this.currentDiffIndex++;
        if (this.currentDiffIndex >= this.diffLines.length) {
            this.currentDiffIndex = 0;
        }

        this.scrollToDiff(this.diffLines[this.currentDiffIndex]);
    }

    /**
     * 导航到上一处差异
     */
    navigateToPrevDiff() {
        if (this.diffLines.length === 0) return;

        this.currentDiffIndex--;
        if (this.currentDiffIndex < 0) {
            this.currentDiffIndex = this.diffLines.length - 1;
        }

        this.scrollToDiff(this.diffLines[this.currentDiffIndex]);
    }

    /**
     * 滚动到指定差异行
     */
    scrollToDiff(lineNum) {
        this.compareEditor.scrollToLine(lineNum);
        this.syncScroll('compare');

        // 高亮当前差异行
        this.highlightCurrentDiff(lineNum);
    }

    /**
     * 高亮当前差异行
     */
    highlightCurrentDiff(lineNum) {
        // 移除之前的高亮
        const prevHighlighted = this.compareLineNumbers.querySelector('.line.current-diff');
        if (prevHighlighted) {
            prevHighlighted.classList.remove('current-diff');
            prevHighlighted.style.backgroundColor = '';
        }

        // 添加新的高亮
        const lineEl = this.compareLineNumbers.querySelector(`.line:nth-child(${lineNum})`);
        if (lineEl) {
            lineEl.classList.add('current-diff');
            lineEl.style.backgroundColor = 'rgba(255, 255, 0, 0.5)';

            // 3秒后移除高亮
            setTimeout(() => {
                lineEl.classList.remove('current-diff');
                lineEl.style.backgroundColor = '';
            }, 3000);
        }
    }

    /**
     * 同步滚动
     */
    syncScroll(source) {
        if (source === 'original') {
            // 同步原始文档的行号滚动
            this.originalLineNumbers.scrollTop = this.originalEditor.virtualScroll.scrollTop;
        } else {
            // 同步比较文档的行号滚动
            this.compareLineNumbers.scrollTop = this.compareEditor.virtualScroll.scrollTop;
        }
    }

    /**
     * 清空所有内容
     */
    clearAll() {
        this.originalEditor.setText('');
        this.compareEditor.setText('');
        this.originalText = '';
        this.compareText = '';
        this.diffLines = [];
        this.currentDiffIndex = -1;

        this.updateLineInfo('original');
        this.updateLineInfo('compare');
        this.updateLineNumbers('original');
        this.updateLineNumbers('compare');
        this.updateSimilarity(0);
        this.clearCompareResult();
        this.updateNavigationButtons();

        // 隐藏大文件警告
        this.originalWarning.classList.remove('visible');
        this.compareWarning.classList.remove('visible');
    }

    /**
     * 关闭窗口
     */
    closeWindow() {
        if (window.electronAPI) {
            window.electronAPI.closeCompareWindow();
        } else {
            window.close();
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    window.compareRenderer = new CompareRenderer();
});

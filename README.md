# FastEdit - 大文件文本编辑器

一款专为处理大文件设计的桌面文本编辑器，支持 800MB+ 文件快速加载，采用虚拟滚动技术实现流畅编辑体验。

## 特性

- **大文件支持**: 使用内存映射技术，支持 800MB+ 文件快速加载
- **虚拟滚动**: 只渲染可视区域内容，保持流畅的滚动体验
- **行号显示**: 左侧显示行号，方便定位
- **光标定位**: 支持点击定位和键盘导航
- **撤销重做**: 支持 100 步撤销/重做
- **深色主题**: 护眼深色界面设计
- **便携部署**: 无需安装，单文件运行

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+O | 打开文件 |
| Ctrl+S | 保存文件 |
| Ctrl+Shift+S | 另存为 |
| Ctrl+Z | 撤销 |
| Ctrl+Y | 重做 |
| Ctrl+X | 剪切 |
| Ctrl+C | 复制 |
| Ctrl+V | 粘贴 |
| Ctrl++ | 放大字体 |
| Ctrl+- | 缩小字体 |
| Ctrl+0 | 重置缩放 |
| ↑/↓/←/→ | 光标移动 |
| Home/End | 行首/行尾 |
| PageUp/PageDown | 翻页 |

## 技术架构

### Windows 原生内存映射实现
- 使用 `koffi` 库调用 Windows API
- **CreateFileW**: 打开文件获取句柄
- **CreateFileMappingW**: 创建文件映射对象
- **MapViewOfFile**: 映射视图到内存
- **UnmapViewOfFile**: 解除视图映射
- **CloseHandle**: 关闭句柄

### 按需加载策略
```
┌─────────────────────────────────────┐
│  文件 (800MB+)                      │
│  ├─ 块1 (64MB) ──→ 映射到内存      │
│  ├─ 块2 (64MB) ──→ 按需映射        │
│  ├─ 块3 (64MB) ──→ 按需映射        │
│  └─ ...                             │
└─────────────────────────────────────┘
```

### 行索引快速映射
- 二分查找算法实现偏移量到行号转换
- 时间复杂度: O(log n)
- 64MB 分块构建索引，支持百万行文件

### 虚拟滚动算法
```
滚动位置 → 起始行号计算 → 内存映射读取 → 行解析 → DOM渲染
```

### 性能优化
- 只渲染可视区域 + 前后各10行缓冲
- 1000 行 LRU 缓存机制
- 请求动画帧优化滚动性能
- 按需映射/解除映射，控制内存占用
- 按需加载指定行范围

## 项目结构

```
Skill_learn/
├── src/
│   ├── main/
│   │   ├── main.js          # Electron 主进程
│   │   └── preload.js       # 预加载脚本（安全通信）
│   └── renderer/
│       ├── index.html       # 主界面
│       └── editor.js        # 编辑器核心逻辑
├── package.json             # 项目配置
├── SPEC.md                  # 详细规格文档
└── README.md                # 本文件
```

## 本地构建

### 环境要求
- Node.js 18+
- npm 9+

### 安装依赖

**Windows PowerShell (管理员)**:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
npm install
```

**或者使用 CMD**:
```cmd
npm install
```

### 开发模式运行
```bash
npm start
```

### 构建便携版

```bash
npm run build
```

构建完成后，可在 `dist/` 目录找到 `FastEdit-Portable.exe`。

## 使用说明

1. 运行 `FastEdit-Portable.exe`
2. 按 `Ctrl+O` 打开文件，或点击菜单栏 文件 → 打开
3. 支持拖放文件到窗口打开
4. 编辑完成后按 `Ctrl+S` 保存

## 性能指标

| 文件大小 | 加载时间 | 内存占用 |
|----------|----------|----------|
| 100 MB   | < 2 秒   | ~150 MB  |
| 500 MB   | < 4 秒   | ~300 MB  |
| 800 MB   | < 5 秒   | ~500 MB  |

*测试环境: Windows 11, i7-12700, 32GB RAM, SSD*

## 技术栈

- **框架**: Electron 33
- **前端**: 原生 HTML/CSS/JavaScript
- **文件处理**: Node.js fs API
- **打包**: electron-builder

## 许可证

MIT License

/**
 * 编码检测与转换模块
 * 支持 UTF-8、GBK、GB2312、GB18030 等编码的自动检测和转换
 */

const iconv = require('iconv-lite');

// 支持的编码列表
const SUPPORTED_ENCODINGS = [
    { name: 'UTF-8', label: 'UTF-8' },
    { name: 'GBK', label: 'GBK' },
    { name: 'GB2312', label: 'GB2312' },
    { name: 'GB18030', label: 'GB18030' },
    { name: 'UTF-16LE', label: 'UTF-16 LE' },
    { name: 'UTF-16BE', label: 'UTF-16 BE' },
    { name: 'BIG5', label: 'Big5' },
    { name: 'SHIFT_JIS', label: 'Shift-JIS' },
    { name: 'EUC-JP', label: 'EUC-JP' },
    { name: 'EUC-KR', label: 'EUC-KR' },
    { name: 'WINDOWS-1252', label: 'Western (Windows-1252)' }
];

/**
 * 检测缓冲区编码
 * @param {Buffer} buffer - 要检测的缓冲区
 * @returns {object} 检测结果 { encoding, confidence }
 */
function detectEncoding(buffer) {
    if (!buffer || buffer.length === 0) {
        return { encoding: 'UTF-8', confidence: 1 };
    }

    // 检查 BOM (Byte Order Mark)
    const bomEncoding = checkBOM(buffer);
    if (bomEncoding) {
        return { encoding: bomEncoding, confidence: 1, hasBOM: true };
    }

    // 检查是否为 UTF-8
    const utf8Score = checkUTF8(buffer);
    if (utf8Score.confidence > 0.95) {
        return { encoding: 'UTF-8', confidence: utf8Score.confidence };
    }

    // 检查是否为 UTF-16
    const utf16Score = checkUTF16(buffer);
    if (utf16Score.confidence > 0.8) {
        return { encoding: utf16Score.encoding, confidence: utf16Score.confidence };
    }

    // 检查中文编码 (GBK/GB2312/GB18030)
    const chineseScore = checkChineseEncoding(buffer);
    if (chineseScore.confidence > 0.7) {
        return { encoding: chineseScore.encoding, confidence: chineseScore.confidence };
    }

    // 检查其他编码
    const otherScore = checkOtherEncodings(buffer);
    if (otherScore.confidence > 0.6) {
        return { encoding: otherScore.encoding, confidence: otherScore.confidence };
    }

    // 默认返回 UTF-8
    return { encoding: 'UTF-8', confidence: 0.5 };
}

/**
 * 检查 BOM
 */
function checkBOM(buffer) {
    if (buffer.length >= 3) {
        // UTF-8 BOM: EF BB BF
        if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
            return 'UTF-8';
        }
    }
    
    if (buffer.length >= 2) {
        // UTF-16 LE BOM: FF FE
        if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
            return 'UTF-16LE';
        }
        // UTF-16 BE BOM: FE FF
        if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
            return 'UTF-16BE';
        }
    }
    
    return null;
}

/**
 * 检查是否为有效的 UTF-8
 */
function checkUTF8(buffer) {
    let validSequences = 0;
    let totalSequences = 0;
    let i = 0;

    while (i < buffer.length) {
        const byte = buffer[i];
        
        // ASCII (0xxxxxxx)
        if ((byte & 0x80) === 0) {
            validSequences++;
            totalSequences++;
            i++;
            continue;
        }

        // 多字节序列
        let bytesNeeded = 0;
        if ((byte & 0xE0) === 0xC0) bytesNeeded = 1;      // 2字节: 110xxxxx
        else if ((byte & 0xF0) === 0xE0) bytesNeeded = 2; // 3字节: 1110xxxx
        else if ((byte & 0xF8) === 0xF0) bytesNeeded = 3; // 4字节: 11110xxx
        else {
            // 无效的 UTF-8 起始字节
            return { confidence: 0 };
        }

        totalSequences++;
        let valid = true;

        // 检查后续字节 (10xxxxxx)
        for (let j = 1; j <= bytesNeeded && i + j < buffer.length; j++) {
            if ((buffer[i + j] & 0xC0) !== 0x80) {
                valid = false;
                break;
            }
        }

        if (valid && i + bytesNeeded < buffer.length) {
            validSequences++;
        }

        i += bytesNeeded + 1;
    }

    const confidence = totalSequences > 0 ? validSequences / totalSequences : 1;
    return { confidence };
}

/**
 * 检查 UTF-16
 */
function checkUTF16(buffer) {
    if (buffer.length < 2) {
        return { confidence: 0 };
    }

    let leValid = 0;
    let beValid = 0;
    let leTotal = 0;
    let beTotal = 0;

    for (let i = 0; i < buffer.length - 1; i += 2) {
        const byte1 = buffer[i];
        const byte2 = buffer[i + 1];

        // UTF-16 LE
        const codeUnitLE = byte1 | (byte2 << 8);
        if (codeUnitLE >= 0xD800 && codeUnitLE <= 0xDFFF) {
            // 代理对，需要检查下一个码元
            if (i + 3 < buffer.length) {
                const byte3 = buffer[i + 2];
                const byte4 = buffer[i + 3];
                const codeUnit2LE = byte3 | (byte4 << 8);
                if (codeUnit2LE >= 0xDC00 && codeUnit2LE <= 0xDFFF) {
                    leValid++;
                    i += 2;
                }
            }
        } else if (codeUnitLE <= 0x10FFFF) {
            leValid++;
        }
        leTotal++;

        // UTF-16 BE
        const codeUnitBE = (byte1 << 8) | byte2;
        if (codeUnitBE >= 0xD800 && codeUnitBE <= 0xDFFF) {
            if (i + 3 < buffer.length) {
                const byte3 = buffer[i + 2];
                const byte4 = buffer[i + 3];
                const codeUnit2BE = (byte3 << 8) | byte4;
                if (codeUnit2BE >= 0xDC00 && codeUnit2BE <= 0xDFFF) {
                    beValid++;
                    i += 2;
                }
            }
        } else if (codeUnitBE <= 0x10FFFF) {
            beValid++;
        }
        beTotal++;
    }

    const leConfidence = leTotal > 0 ? leValid / leTotal : 0;
    const beConfidence = beTotal > 0 ? beValid / beTotal : 0;

    if (leConfidence > beConfidence && leConfidence > 0.8) {
        return { encoding: 'UTF-16LE', confidence: leConfidence };
    } else if (beConfidence > leConfidence && beConfidence > 0.8) {
        return { encoding: 'UTF-16BE', confidence: beConfidence };
    }

    return { confidence: 0 };
}

/**
 * 检查中文编码特征
 */
function checkChineseEncoding(buffer) {
    let gbkValid = 0;
    let gbkTotal = 0;

    for (let i = 0; i < buffer.length; i++) {
        const byte = buffer[i];

        // GBK 双字节字符: 第一个字节 0x81-0xFE
        if (byte >= 0x81 && byte <= 0xFE) {
            if (i + 1 < buffer.length) {
                const byte2 = buffer[i + 1];
                // 第二个字节 0x40-0xFE (不包括 0x7F)
                if ((byte2 >= 0x40 && byte2 <= 0x7E) || (byte2 >= 0x80 && byte2 <= 0xFE)) {
                    gbkValid++;
                }
                gbkTotal++;
                i++;
            }
        }
    }

    if (gbkTotal > 0) {
        const confidence = gbkValid / gbkTotal;
        if (confidence > 0.7) {
            // 区分 GB2312 和 GBK
            // GB2312 的第一个字节范围是 0xA1-0xF7
            let gb2312Count = 0;
            for (let i = 0; i < buffer.length; i++) {
                if (buffer[i] >= 0xA1 && buffer[i] <= 0xF7) {
                    if (i + 1 < buffer.length && buffer[i + 1] >= 0xA1 && buffer[i + 1] <= 0xFE) {
                        gb2312Count++;
                    }
                }
            }

            if (gb2312Count === gbkValid && confidence > 0.9) {
                return { encoding: 'GB2312', confidence };
            }
            return { encoding: 'GBK', confidence };
        }
    }

    return { confidence: 0 };
}

/**
 * 检查其他编码
 */
function checkOtherEncodings(buffer) {
    const encodings = ['BIG5', 'SHIFT_JIS', 'EUC-JP', 'EUC-KR', 'WINDOWS-1252'];
    
    for (const encoding of encodings) {
        try {
            const decoded = iconv.decode(buffer, encoding);
            const reencoded = iconv.encode(decoded, encoding);
            
            // 如果重新编码后与原始数据一致，说明可能是该编码
            if (reencoded.equals(buffer)) {
                return { encoding, confidence: 0.7 };
            }
        } catch (e) {
            // 忽略解码错误
        }
    }

    return { confidence: 0 };
}

/**
 * 将缓冲区转换为字符串
 * @param {Buffer} buffer - 要转换的缓冲区
 * @param {string} encoding - 源编码
 * @returns {string} 转换后的字符串
 */
function bufferToString(buffer, encoding) {
    if (!buffer || buffer.length === 0) {
        return '';
    }

    try {
        // 处理 BOM
        let startOffset = 0;
        if (encoding === 'UTF-8' && buffer.length >= 3) {
            if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
                startOffset = 3;
            }
        } else if ((encoding === 'UTF-16LE' || encoding === 'UTF-16BE') && buffer.length >= 2) {
            if ((buffer[0] === 0xFF && buffer[1] === 0xFE) || 
                (buffer[0] === 0xFE && buffer[1] === 0xFF)) {
                startOffset = 2;
            }
        }

        const dataBuffer = startOffset > 0 ? buffer.slice(startOffset) : buffer;
        return iconv.decode(dataBuffer, encoding);
    } catch (error) {
        console.error('编码转换失败:', error);
        // 回退到 UTF-8
        return dataBuffer.toString('utf-8');
    }
}

/**
 * 将字符串转换为指定编码的缓冲区
 * @param {string} str - 要转换的字符串
 * @param {string} encoding - 目标编码
 * @param {boolean} addBOM - 是否添加 BOM
 * @returns {Buffer} 转换后的缓冲区
 */
function stringToBuffer(str, encoding, addBOM = false) {
    try {
        let buffer = iconv.encode(str, encoding);

        // 添加 BOM
        if (addBOM) {
            let bomBuffer = null;
            if (encoding === 'UTF-8') {
                bomBuffer = Buffer.from([0xEF, 0xBB, 0xBF]);
            } else if (encoding === 'UTF-16LE') {
                bomBuffer = Buffer.from([0xFF, 0xFE]);
            } else if (encoding === 'UTF-16BE') {
                bomBuffer = Buffer.from([0xFE, 0xFF]);
            }

            if (bomBuffer) {
                buffer = Buffer.concat([bomBuffer, buffer]);
            }
        }

        return buffer;
    } catch (error) {
        console.error('编码转换失败:', error);
        return Buffer.from(str, 'utf-8');
    }
}

/**
 * 检测文件编码
 * @param {string} filePath - 文件路径
 * @param {number} sampleSize - 采样大小（默认 64KB）
 * @returns {Promise<object>} 检测结果
 */
async function detectFileEncoding(filePath, sampleSize = 64 * 1024) {
    const fs = require('fs').promises;
    
    try {
        const fd = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(sampleSize);
        const { bytesRead } = await fd.read(buffer, 0, sampleSize, 0);
        await fd.close();

        const actualBuffer = buffer.slice(0, bytesRead);
        const result = detectEncoding(actualBuffer);
        
        return {
            ...result,
            sampleSize: bytesRead
        };
    } catch (error) {
        console.error('检测文件编码失败:', error);
        return { encoding: 'UTF-8', confidence: 0 };
    }
}

module.exports = {
    SUPPORTED_ENCODINGS,
    detectEncoding,
    detectFileEncoding,
    bufferToString,
    stringToBuffer
};

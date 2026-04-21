import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

/**
 * 从 Excel 文件中提取提示词
 * 默认提取第一列或特定标记列的非空文本
 */
export const parseExcel = async (file: File): Promise<string[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // 将表格转换为 JSON，每一行作为一个对象或数组
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

                // 提取所有非空单元格中的文本
                // 简单起见，如果只有一列，取那一列；如果多列，可能需要用户指定或取第一列
                // 这里取每一行的第一个非空单元格内容作为提示词
                const prompts: string[] = jsonData
                    .map(row => row.find(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''))
                    .filter(prompt => prompt !== undefined)
                    .map(prompt => String(prompt).trim());

                resolve(prompts);
            } catch (err) {
                reject(new Error('解析 Excel 失败: ' + (err as Error).message));
            }
        };
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsArrayBuffer(file);
    });
};

/**
 * 从 Word 文件中提取提示词
 * 每一行（段落）作为一个提示词
 */
export const parseWord = async (file: File): Promise<string[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target?.result as ArrayBuffer;
                const result = await mammoth.extractRawText({ arrayBuffer });
                const text = result.value;

                // 按行分割，过滤掉空行
                const prompts = text
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => line.length > 0);

                resolve(prompts);
            } catch (err) {
                reject(new Error('解析 Word 失败: ' + (err as Error).message));
            }
        };
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsArrayBuffer(file);
    });
};

/**
 * 通用解析函数
 */
export const parsePromptFile = async (file: File): Promise<string[]> => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'xlsx' || extension === 'xls') {
        return parseExcel(file);
    } else if (extension === 'docx') {
        return parseWord(file);
    } else if (extension === 'txt') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target?.result as string;
                const prompts = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
                resolve(prompts);
            };
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsText(file);
        });
    } else {
        throw new Error('不支持的文件格式，请上传 .xlsx, .docx 或 .txt');
    }
};

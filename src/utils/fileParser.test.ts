import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseExcelPreview } from './fileParser';

describe('Excel batch prompt preview', () => {
  it('returns workbook sheet names, header labels, and selectable column values', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['SKU', '提示词'],
      ['A-01', 'glass bottle'],
      ['A-02', 'wooden table'],
    ]), 'Products');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['prompt'], ['silver cup']]), 'Other');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([bytes], 'prompts.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const preview = await parseExcelPreview(file);

    expect(preview.sheets.map((sheet) => sheet.name)).toEqual(['Products', 'Other']);
    expect(preview.sheets[0].columns).toEqual(['SKU (列 1)', '提示词 (列 2)']);
    expect(preview.sheets[0].rows[1][1]).toBe('glass bottle');
    expect(preview.sheets[0].rows[2][1]).toBe('wooden table');
  });
});

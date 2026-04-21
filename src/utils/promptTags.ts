export interface PromptTagParseResult {
  prompt: string;
  referencedIndexes: number[];
  error?: string;
}

export const parsePromptReferenceTags = (
  rawPrompt: string,
  referenceCount: number
): PromptTagParseResult => {
  const referenceTagRegex = /@图\s*([1-9]\d*)/gi;
  const indexesInOrder: number[] = [];
  const seenIndexes = new Set<number>();

  let match: RegExpExecArray | null;
  while ((match = referenceTagRegex.exec(rawPrompt)) !== null) {
    const index = Number(match[1]);
    if (!Number.isNaN(index) && !seenIndexes.has(index)) {
      seenIndexes.add(index);
      indexesInOrder.push(index);
    }
  }

  if (indexesInOrder.length > 0 && referenceCount <= 0) {
    return {
      prompt: rawPrompt.trim(),
      referencedIndexes: [],
      error: '检测到 @图N，但当前没有上传参考图',
    };
  }

  const invalidIndexes = indexesInOrder.filter((n) => n < 1 || n > referenceCount);
  if (invalidIndexes.length > 0) {
    const uniqInvalid = Array.from(new Set(invalidIndexes)).sort((a, b) => a - b);
    return {
      prompt: rawPrompt.trim(),
      referencedIndexes: [],
      error: `提示词里引用了不存在的参考图编号：${uniqInvalid.map((n) => `图${n}`).join('、')}`,
    };
  }

  const normalizedPrompt = rawPrompt
    .replace(/@图\s*([1-9]\d*)/gi, (_m, n) => `图${n}`)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (!normalizedPrompt) {
    return {
      prompt: '',
      referencedIndexes: indexesInOrder.map((n) => n - 1),
      error: '提示词不能为空',
    };
  }

  return {
    prompt: normalizedPrompt,
    referencedIndexes: indexesInOrder.map((n) => n - 1),
  };
};


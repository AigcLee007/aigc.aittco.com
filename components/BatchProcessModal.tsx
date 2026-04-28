import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  FileText,
  Play,
  Square,
  CheckCircle,
  AlertCircle,
  Loader2,
  Plus,
  Edit3,
  Trash2,
  Eraser,
} from 'lucide-react';
import { parsePromptFile } from '../src/utils/fileParser';
import { BatchProcessor, ProgressInfo, BatchTask } from '../src/utils/batchProcessor';
import { generateImage, editImage } from '../services/geminiService';
import { useSelectionStore } from '../src/store/selectionStore';
import { getImageModelNameForRoute, getSelectedImageRoute } from '../src/config/imageRoutes';
import { useImageRouteCatalog } from '../src/hooks/useImageRouteCatalog';
import {
  getImageModelById,
  getImageModelExtraAspectRatios,
  getImageModelSizeOptions,
  getNormalizedImageSizeForModel,
} from '../src/config/imageModels';
import { useImageModelCatalog } from '../src/hooks/useImageModelCatalog';
import GlassModal from './GlassModal';

interface BatchProcessModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string | null;
  onInitGenerations: (
    count: number,
    prompt: string,
    aspectRatio?: string,
    baseNode?: any,
    type?: 'IMAGE' | 'VIDEO',
    options?: { preserveToolMode?: boolean },
  ) => string[];
  onUpdateGeneration: (id: string, src: string | null, error?: string) => void;
}

type PromptItem = {
  text: string;
  status: 'idle' | 'loading' | 'success' | 'failed';
  error?: string;
};

const BatchProcessModal: React.FC<BatchProcessModalProps> = ({
  isOpen,
  onClose,
  apiKey,
  onInitGenerations,
  onUpdateGeneration,
}) => {
  useImageRouteCatalog();
  useImageModelCatalog();
  const { imageModel, imageLine } = useSelectionStore();
  const [activeTab, setActiveTab] = useState<'T2I' | 'I2I'>('T2I');
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [unifiedPrompt, setUnifiedPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [imageSize, setImageSize] = useState('1k');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');

  const selectedImageModelConfig = getImageModelById(imageModel);
  const selectedImageRoute = getSelectedImageRoute(imageModel, imageLine);
  const selectedImageModel = getImageModelNameForRoute({
    imageModel,
    imageLine,
    imageSize,
  });
  const normalizedImageSize = getNormalizedImageSizeForModel(imageModel, imageSize);
  const sizeOptions = getImageModelSizeOptions(imageModel);
  const aspectRatioOptions = useMemo(() => {
    const baseOptions = ['1:1', '16:9', '9:16', '4:3', '3:4'];
    return Array.from(
      new Set([...baseOptions, ...getImageModelExtraAspectRatios(imageModel)]),
    );
  }, [imageModel]);

  useEffect(() => {
    if (normalizedImageSize === imageSize) return;
    setImageSize(normalizedImageSize);
  }, [imageSize, normalizedImageSize]);

  const processorRef = useRef<BatchProcessor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const updatePromptItem = (index: number, updates: Partial<PromptItem>) => {
    setPrompts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const extractedPrompts = await parsePromptFile(file);
      setPrompts(extractedPrompts.map((text) => ({ text, status: 'idle' })));
      setEditingIndex(null);
    } catch (error) {
      alert((error as Error).message);
    } finally {
      event.target.value = '';
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        if (loadEvent.target?.result) {
          setRefImages((prev) => [...prev, loadEvent.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });

    event.target.value = '';
  };

  const executeTask = async (task: BatchTask, promptIndex?: number) => {
    const baseNode = task.referenceImage
      ? { type: 'IMAGE', src: task.referenceImage, width: 512, height: 512 }
      : undefined;
    const placeholderIds = onInitGenerations(1, task.prompt, aspectRatio, baseNode);
    const generationId = placeholderIds[0];

    if (typeof promptIndex === 'number') {
      updatePromptItem(promptIndex, { status: 'loading', error: undefined });
    }

    try {
      const srcs =
        task.type === 'T2I'
          ? await generateImage(
              apiKey || undefined,
              task.prompt,
              aspectRatio,
              imageSize,
              1,
              undefined,
              {
                routeId: selectedImageRoute.id,
                model: selectedImageModel,
                modelId: imageModel,
              },
            )
          : await editImage(
              apiKey || undefined,
              task.referenceImage!,
              task.prompt,
              aspectRatio,
              imageSize,
              1,
              undefined,
              {
                routeId: selectedImageRoute.id,
                model: selectedImageModel,
                modelId: imageModel,
              },
            );

      if (!srcs.length) {
        throw new Error('No image was returned');
      }

      onUpdateGeneration(generationId, srcs[0]);

      if (typeof promptIndex === 'number') {
        updatePromptItem(promptIndex, { status: 'success', error: undefined });
      }

      return srcs[0];
    } catch (error) {
      const message = (error as Error).message;
      onUpdateGeneration(generationId, null, message);

      if (typeof promptIndex === 'number') {
        updatePromptItem(promptIndex, { status: 'failed', error: message });
      }

      throw error;
    }
  };

  const startBatchProcess = async () => {
    const tasks: (Omit<BatchTask, 'status' | 'id'> & { id?: string })[] = [];

    if (activeTab === 'T2I') {
      if (prompts.length === 0) return;
      prompts.forEach((prompt, index) => {
        if (prompt.status !== 'success') {
          tasks.push({ type: 'T2I', prompt: prompt.text, id: `t2i-${index}` });
        }
      });
    } else {
      if (refImages.length === 0 || !unifiedPrompt.trim()) return;
      refImages.forEach((image, index) => {
        tasks.push({
          type: 'I2I',
          prompt: unifiedPrompt.trim(),
          referenceImage: image,
          id: `i2i-${index}`,
        });
      });
    }

    setIsProcessing(true);
    setProgress(null);

    const processor = new BatchProcessor(3, (info) => setProgress(info));
    processorRef.current = processor;
    processor.addTasks(tasks);

    try {
      await processor.start(async (task) => {
        const taskIndex =
          task.type === 'T2I' ? Number.parseInt(task.id.split('-')[1] || '0', 10) : undefined;
        return executeTask(task, taskIndex);
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const stopProcess = () => {
    processorRef.current?.stop();
    setIsProcessing(false);
  };

  const handleEditPrompt = (index: number) => {
    setEditingIndex(index);
    setEditingText(prompts[index].text);
  };

  const saveEditPrompt = () => {
    if (editingIndex === null) return;

    updatePromptItem(editingIndex, {
      text: editingText,
      status: 'idle',
      error: undefined,
    });
    setEditingIndex(null);
  };

  const deletePrompt = (index: number) => {
    setPrompts((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
    }
  };

  const retryPrompt = (index: number) => {
    if (isProcessing) return;

    const task = {
      type: 'T2I' as const,
      prompt: prompts[index].text,
      id: `t2i-${index}`,
    };

    setIsProcessing(true);
    setProgress(null);

    const processor = new BatchProcessor(1, (info) => setProgress(info));
    processorRef.current = processor;
    processor.addTasks([task]);

    void processor
      .start(async (currentTask) => executeTask(currentTask, index))
      .finally(() => setIsProcessing(false));
  };

  const clearPrompts = () => {
    if (!window.confirm('Clear all imported prompts?')) return;
    setPrompts([]);
    setEditingIndex(null);
  };

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title="Batch Generation Center"
      width="max-w-5xl"
      className="h-[85vh]"
      contentClassName="overflow-hidden flex flex-col"
    >
      <div className="flex h-full flex-col bg-transparent">
        <div className="flex shrink-0 border-b border-white/5 bg-black/20">
          <button
            onClick={() => !isProcessing && setActiveTab('T2I')}
            className={`relative flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'T2I'
                ? 'bg-blue-500/5 text-blue-400'
                : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
            }`}
          >
            Text to Image
            {activeTab === 'T2I' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
            )}
          </button>
          <button
            onClick={() => !isProcessing && setActiveTab('I2I')}
            className={`relative flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'I2I'
                ? 'bg-blue-500/5 text-blue-400'
                : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
            }`}
          >
            Image to Image
            {activeTab === 'I2I' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-none custom-scrollbar flex flex-col gap-6">
          <div className="rounded-2xl border border-blue-500/15 bg-blue-500/5 px-4 py-3 text-xs text-blue-200">
            <div className="font-medium">Current route: {selectedImageRoute.label}</div>
            <div className="mt-1 text-blue-200/70">
              Upstream model: {selectedImageModel}
            </div>
          </div>

          {activeTab === 'T2I' ? (
            <div className="space-y-4">
              <div
                onClick={() => !isProcessing && fileInputRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-8 transition-all ${
                  prompts.length > 0
                    ? 'border-blue-500/30 bg-blue-500/5'
                    : 'border-white/10 bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="flex flex-col items-center gap-3 text-center">
                  <FileText size={40} className={prompts.length > 0 ? 'text-blue-400' : 'text-gray-600'} />
                  <div>
                    <p className="text-sm font-medium text-gray-200">
                      Upload a prompt file
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Supports `.xlsx`, `.xls`, `.docx`, and `.txt`
                    </p>
                  </div>
                  {prompts.length > 0 && (
                    <div className="rounded-full border border-blue-500/20 bg-blue-500/20 px-3 py-1 text-xs text-blue-300">
                      Loaded {prompts.length} prompts
                    </div>
                  )}
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.docx,.txt"
                className="hidden"
                onChange={handleFileUpload}
              />

              {prompts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-400">
                      Prompt list ({prompts.length})
                    </span>
                    <button
                      onClick={clearPrompts}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                    >
                      <Eraser size={12} />
                      Clear list
                    </button>
                  </div>

                  <div className="max-h-[300px] overflow-y-auto rounded-xl border border-white/5 bg-black/20 custom-scrollbar divide-y divide-white/5">
                    {prompts.map((prompt, index) => (
                      <div
                        key={index}
                        className="group flex items-start gap-3 p-3 transition-colors hover:bg-white/5"
                      >
                        <span className="mt-1 shrink-0 font-mono text-[10px] text-gray-600">
                          {String(index + 1).padStart(2, '0')}
                        </span>

                        <div className="min-w-0 flex-1">
                          {editingIndex === index ? (
                            <div className="flex flex-col gap-2">
                              <textarea
                                autoFocus
                                value={editingText}
                                onChange={(event) => setEditingText(event.target.value)}
                                className="min-h-[60px] w-full resize-none rounded border border-blue-500/50 bg-black/40 p-2 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                                    saveEditPrompt();
                                  }
                                  if (event.key === 'Escape') {
                                    setEditingIndex(null);
                                  }
                                }}
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => setEditingIndex(null)}
                                  className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={saveEditPrompt}
                                  className="rounded bg-blue-600 px-2 py-1 text-[10px] text-white transition-colors hover:bg-blue-500"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <p className="break-words text-xs leading-relaxed text-gray-300">
                                {prompt.text}
                              </p>
                              {prompt.status === 'failed' && (
                                <p className="flex items-center gap-1 text-[10px] text-red-400">
                                  <AlertCircle size={10} />
                                  Failed: {prompt.error}
                                </p>
                              )}
                              {prompt.status === 'success' && (
                                <p className="flex items-center gap-1 text-[10px] text-green-400">
                                  <CheckCircle size={10} />
                                  Generated
                                </p>
                              )}
                              {prompt.status === 'loading' && (
                                <p className="flex items-center gap-1 text-[10px] text-blue-400">
                                  <Loader2 size={10} className="animate-spin" />
                                  Generating...
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {!isProcessing && editingIndex !== index && (
                          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            {prompt.status === 'failed' && (
                              <button
                                onClick={() => retryPrompt(index)}
                                className="rounded p-1.5 text-orange-400 transition-colors hover:bg-orange-500/10"
                                title="Retry"
                              >
                                <Play size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => handleEditPrompt(index)}
                              className="rounded p-1.5 text-gray-500 transition-colors hover:bg-blue-500/10 hover:text-blue-400"
                              title="Edit"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button
                              onClick={() => deletePrompt(index)}
                              className="rounded p-1.5 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <p className="text-[10px] italic text-gray-600">
                    Tip: use Ctrl/Cmd + Enter to save a prompt edit quickly.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs text-gray-400">
                  Reference images ({refImages.length})
                </label>
                <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-3 custom-scrollbar">
                  {refImages.map((src, index) => (
                    <div
                      key={index}
                      className="group relative h-20 w-20 overflow-hidden rounded-lg border border-white/10"
                    >
                      <img src={src} alt="" className="h-full w-full object-cover" />
                      <button
                        onClick={() =>
                          setRefImages((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                        }
                        className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 backdrop-blur-sm transition-all group-hover:opacity-100 hover:bg-red-500"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={() => imgInputRef.current?.click()}
                    className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/5 text-gray-500 transition-all hover:border-white/30 hover:bg-white/10 hover:text-gray-300"
                  >
                    <Plus size={20} />
                    <span className="mt-1 text-[10px]">Add</span>
                  </button>
                </div>
                <input
                  ref={imgInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleImageUpload}
                />
              </div>

              <div>
                <label className="mb-2 block text-xs text-gray-400">
                  Shared prompt
                </label>
                <textarea
                  value={unifiedPrompt}
                  onChange={(event) => setUnifiedPrompt(event.target.value)}
                  placeholder="Describe how all reference images should be transformed..."
                  className="h-24 w-full resize-none rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-gray-200 placeholder-gray-600 transition-all focus:border-blue-500/50 focus:bg-white/10 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Aspect ratio</label>
              <select
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value)}
                className="w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-200 transition-colors hover:bg-white/10 focus:border-white/20 focus:outline-none"
              >
                {aspectRatioOptions.map((ratio) => (
                  <option key={ratio} value={ratio} className="bg-gray-900">
                    {ratio}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-500">Image size</label>
              <select
                value={normalizedImageSize}
                onChange={(event) => setImageSize(event.target.value)}
                className="w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-200 transition-colors hover:bg-white/10 focus:border-white/20 focus:outline-none"
              >
                {sizeOptions.map((size) => (
                  <option key={size} value={size} className="bg-gray-900">
                    {size.toUpperCase()}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[10px] text-gray-500">
                当前模型：{selectedImageModelConfig.label}
              </div>
            </div>
          </div>

          {progress && (
            <div className="space-y-3 border-t border-white/5 py-4">
              <div className="mb-1 flex items-center justify-between text-xs font-medium">
                <span className="text-gray-400">
                  Progress: {progress.completed} / {progress.total}
                </span>
                <span className="font-bold text-blue-400">
                  {progress.total ? Math.round((progress.completed / progress.total) * 100) : 0}%
                </span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full border border-white/5 bg-white/5">
                <div
                  className="h-full bg-linear-to-r from-blue-600 to-indigo-500 shadow-[0_0_10px_rgba(59,130,246,0.3)] transition-all duration-300"
                  style={{
                    width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-4 text-[10px]">
                <span className="flex items-center gap-1 rounded border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-green-400">
                  <CheckCircle size={10} />
                  Success {progress.success}
                </span>
                <span className="flex items-center gap-1 rounded border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-red-400">
                  <AlertCircle size={10} />
                  Failed {progress.failed}
                </span>
                {progress.currentTask && (
                  <span className="max-w-[220px] truncate italic text-gray-500">
                    Running: {progress.currentTask.prompt.substring(0, 24)}...
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-3 border-t border-white/5 bg-black/20 p-6">
          {isProcessing ? (
            <button
              onClick={stopProcess}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 py-3 font-bold text-red-500 transition-all active:scale-95 hover:bg-red-500/20"
            >
              <Square size={16} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              onClick={startBatchProcess}
              disabled={
                (activeTab === 'T2I' && prompts.length === 0) ||
                (activeTab === 'I2I' && (refImages.length === 0 || !unifiedPrompt.trim()))
              }
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 py-3 font-bold text-white shadow-lg shadow-blue-900/20 transition-all active:scale-95 hover:from-blue-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:grayscale disabled:opacity-50"
            >
              <Play size={16} fill="currentColor" />
              Start Batch
            </button>
          )}
        </div>
      </div>
    </GlassModal>
  );
};

export default BatchProcessModal;

import React, { useCallback, useRef, useState } from 'react';
import {
    Check,
    Copy,
    Loader2,
    ScanSearch,
    Sparkles as SparklesIcon,
    Upload,
} from 'lucide-react';
import GlassModal from './GlassModal';
import { reversePrompt } from '../services/reversePromptService';
import { useSelectionStore } from '../src/store/selectionStore';

interface ReversePromptModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUsePrompt?: (prompt: string) => void;
}

const ReversePromptModal: React.FC<ReversePromptModalProps> = ({ isOpen, onClose, onUsePrompt }) => {
    const apiKey = useSelectionStore((state) => state.apiKey);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = useCallback((file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('请上传有效的图片文件');
            return;
        }

        setImageFile(file);
        setError(null);
        setResult('');

        const reader = new FileReader();
        reader.onload = (event) => setPreview(event.target?.result as string);
        reader.readAsDataURL(file);
    }, []);

    const handleDrop = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();

        if (event.dataTransfer.files && event.dataTransfer.files[0]) {
            handleFile(event.dataTransfer.files[0]);
        }
    }, [handleFile]);

    const handleAnalyze = async () => {
        if (!imageFile) return;

        setLoading(true);
        setError(null);

        try {
            const trimmedApiKey = apiKey.trim();
            if (!trimmedApiKey) {
                throw new Error('请先在设置中配置 API Key');
            }

            const prompt = await reversePrompt(trimmedApiKey, imageFile);
            setResult(prompt);
        } catch (err: any) {
            setError(err.message || '分析失败，请重试');
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = () => {
        if (!result) return;
        navigator.clipboard.writeText(result);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
    };

    const handleClose = () => {
        setImageFile(null);
        setPreview(null);
        setResult('');
        setError(null);
        setCopied(false);
        onClose();
    };

    return (
        <GlassModal
            isOpen={isOpen}
            onClose={handleClose}
            title="图片逆推提示词"
            width="max-w-lg"
        >
            <div className="flex h-full flex-col space-y-6 pt-2">
                <div className="px-1 text-sm text-gray-400">
                    上传一张图片，AI 会自动分析画面内容并生成可复用的详细提示词。
                </div>

                <div className="space-y-2">
                    {!preview ? (
                        <div
                            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                                error
                                    ? 'border-red-500/50 bg-red-900/10'
                                    : 'border-white/10 hover:border-blue-500/50 hover:bg-white/5'
                            }`}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <div className="mb-4 inline-flex rounded-full bg-white/5 p-4 ring-1 ring-white/10">
                                <Upload className="text-blue-400" size={32} />
                            </div>
                            <h3 className="mb-1 text-base font-medium text-gray-200">点击或拖拽上传图片</h3>
                            <p className="text-sm text-gray-500">支持 JPG、PNG、WEBP</p>
                            <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) handleFile(file);
                                }}
                            />
                        </div>
                    ) : (
                        <div className="group relative flex max-h-[300px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/50 shadow-lg">
                            <img src={preview} alt="Preview" className="max-h-[300px] max-w-full object-contain" />
                            <div className="absolute inset-0 flex items-center justify-center gap-4 bg-black/60 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="rounded-lg border border-white/10 bg-white/10 px-4 py-2 text-white transition-colors hover:bg-white/20"
                                >
                                    更换图片
                                </button>
                                {loading ? (
                                    <div className="flex items-center gap-2 text-white">
                                        <Loader2 className="animate-spin" size={18} />
                                        分析中...
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {error ? (
                        <div className="flex items-center gap-2 px-2 text-sm text-red-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                            {error}
                        </div>
                    ) : null}
                </div>

                {preview && !result && !loading ? (
                    <button
                        onClick={handleAnalyze}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 py-3 font-medium text-white shadow-lg shadow-blue-900/20 transition-all hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98]"
                    >
                        <ScanSearch size={18} />
                        开始分析并生成提示词
                    </button>
                ) : null}

                {loading ? (
                    <div className="space-y-4 rounded-xl border border-white/5 bg-white/5 py-8 text-center">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-500" />
                        <p className="text-sm text-gray-400">正在分析图片细节，请稍候...</p>
                    </div>
                ) : null}

                {result ? (
                    <div className="flex min-h-0 flex-1 flex-col space-y-3">
                        <div className="flex items-center justify-between px-1">
                            <h3 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                                <SparklesIcon className="text-yellow-500" size={16} />
                                分析结果
                            </h3>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleCopy}
                                    className="flex items-center gap-1.5 rounded-md border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10"
                                >
                                    {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                                    {copied ? '已复制' : '复制'}
                                </button>
                                {onUsePrompt ? (
                                    <button
                                        onClick={() => {
                                            onUsePrompt(result);
                                            onClose();
                                        }}
                                        className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 text-xs text-blue-400 transition-colors hover:bg-blue-500/20"
                                    >
                                        使用此提示词
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        <div className="custom-scrollbar relative flex-1 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-4 shadow-inner">
                            <p className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-gray-300">
                                {result}
                            </p>
                        </div>
                    </div>
                ) : null}
            </div>
        </GlassModal>
    );
};

export default ReversePromptModal;

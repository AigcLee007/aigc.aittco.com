import React from 'react';
import SettingsModal from '../../components/SettingsModal';
import ReversePromptModal from '../../components/ReversePromptModal';
import BatchProcessModal from '../../components/BatchProcessModal';
import InstructionsModal from '../../components/InstructionsModal';
import ContextMenu from '../../components/ContextMenu';
import AnnouncementPopup from '../../components/AnnouncementPopup';
import { X } from 'lucide-react';

interface ModalsContainerProps {
  settingsOpen: boolean;
  settingsTab: 'settings' | 'history';
  onCloseSettings: () => void;
  onReusePrompt: (prompt: string, type: 'image' | 'video') => void;
  onViewImage: (src: string) => void;
  onUseAsReference: (src: string) => void;
  onDownloadImage: (src: string, prompt?: string, id?: string) => void;

  reversePromptOpen: boolean;
  onCloseReversePrompt: () => void;
  onUsePrompt: (prompt: string) => void;

  batchModalOpen: boolean;
  onCloseBatchModal: () => void;
  batchApiKey: string | null;
  onInitGenerations: (count: number, prompt: string, aspectRatio?: string, baseNode?: any, type?: 'IMAGE' | 'VIDEO') => string[];
  onUpdateGeneration: (id: string, src: string | null, error?: string, taskId?: string) => void;

  instructionsOpen: boolean;
  onCloseInstructions: () => void;

  lightboxImage: string | null;
  onCloseLightbox: () => void;

  showClearConfirm: boolean;
  onCloseClearConfirm: () => void;
  onConfirmClear: () => void;

  // Context Menu
  onDuplicate: () => void;
  onRemoveBackground: () => void;
  onDownloadNode: () => void;
  onCopyLink: () => void;
}

export const ModalsContainer: React.FC<ModalsContainerProps> = ({
  settingsOpen,
  settingsTab,
  onCloseSettings,
  onReusePrompt,
  onViewImage,
  onUseAsReference,
  onDownloadImage,
  reversePromptOpen,
  onCloseReversePrompt,
  onUsePrompt,
  batchModalOpen,
  onCloseBatchModal,
  batchApiKey,
  onInitGenerations,
  onUpdateGeneration,
  instructionsOpen,
  onCloseInstructions,
  lightboxImage,
  onCloseLightbox,
  showClearConfirm,
  onCloseClearConfirm,
  onConfirmClear,
  onDuplicate,
  onRemoveBackground,
  onDownloadNode,
  onCopyLink
}) => {
  return (
    <>
      <AnnouncementPopup />
      <SettingsModal
        isOpen={settingsOpen}
        initialTab={settingsTab}
        onClose={onCloseSettings}
        onReusePrompt={onReusePrompt}
        onViewImage={onViewImage}
        onUseAsReference={onUseAsReference}
        onDownloadImage={onDownloadImage}
      />

      <ReversePromptModal
        isOpen={reversePromptOpen}
        onClose={onCloseReversePrompt}
        onUsePrompt={onUsePrompt}
      />

      <BatchProcessModal
        isOpen={batchModalOpen}
        onClose={onCloseBatchModal}
        apiKey={batchApiKey}
        onInitGenerations={onInitGenerations}
        onUpdateGeneration={onUpdateGeneration}
      />

      <InstructionsModal
        isOpen={instructionsOpen}
        onClose={onCloseInstructions}
      />

      {lightboxImage && (
        <div className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-md flex items-center justify-center p-8" onClick={onCloseLightbox}>
          <button onClick={onCloseLightbox} className="absolute top-4 right-4 p-2 text-white/70 hover:text-white bg-white/10 rounded-full"><X size={24} /></button>
          
          {(lightboxImage.toLowerCase().endsWith('.mp4') || lightboxImage.toLowerCase().includes('format=mp4')) ? (
             <video 
               src={lightboxImage} 
               className="max-w-full max-h-full object-contain shadow-2xl rounded-sm"
               controls
               autoPlay
               loop
               onClick={(e) => e.stopPropagation()} 
             />
          ) : (
             <img src={lightboxImage} className="max-w-full max-h-full object-contain shadow-2xl rounded-sm" onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center" onClick={onCloseClearConfirm}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">确认清空</h3>
            <p className="text-gray-400 text-sm mb-6">确定要清空画布上的所有内容吗？此操作无法撤销。</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onCloseClearConfirm}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={onConfirmClear}
                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}

      <ContextMenu
        onDuplicate={onDuplicate}
        onRemoveBackground={onRemoveBackground}
        onDownload={onDownloadNode}
        onCopyLink={onCopyLink}
      />
    </>
  );
};

import React, { ReactNode } from 'react';

interface MainLayoutProps {
  children: ReactNode;
  onContextMenuClose: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  onContextMenuClose,
  onDragOver,
  onDrop
}) => {
  return (
    <div
      className="w-screen h-screen bg-neutral-900 text-white overflow-hidden flex flex-col"
      onClick={onContextMenuClose}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
};

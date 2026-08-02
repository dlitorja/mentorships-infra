'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Paperclip, Loader2 } from 'lucide-react';
import type { ChatInputBarProps } from '../types';

export function ChatInputBar({
  message,
  onChangeMessage,
  onSendMessage,
  onAttachClick,
  isUploading,
  isSending,
}: ChatInputBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  return (
    <div className="p-3 border-t shrink-0">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onAttachClick}
          disabled={isUploading}
          aria-label="Attach files"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
        </Button>
        <Textarea
          value={message}
          onChange={(e) => onChangeMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="min-h-[44px] max-h-32 resize-none"
          rows={1}
        />
        <Button onClick={onSendMessage} disabled={!message.trim() || isSending} aria-label="Send message">
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-center">
        Drag and drop images or files directly into the chat
      </p>
    </div>
  );
}

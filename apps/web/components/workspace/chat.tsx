'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Id } from '../../../../convex/_generated/dataModel';
import { useWorkspaceMessages, useCreateWorkspaceMessage, useCreateWorkspaceImage } from '@/lib/queries/convex/use-workspaces';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Send, Image as ImageIcon, X, Upload } from 'lucide-react';
import { clsx } from 'clsx';

interface Message {
  _id: Id<'workspaceMessages'>;
  workspaceId: Id<'workspaces'>;
  userId: string;
  content: string;
  type: 'text' | 'image' | 'file';
}

interface WorkspaceChatProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
}

export default function WorkspaceChat({ workspaceId, currentUserId }: WorkspaceChatProps) {
  const [message, setMessage] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: messages, isLoading } = useWorkspaceMessages(workspaceId);
  const createMessage = useCreateWorkspaceMessage();
  const createImage = useCreateWorkspaceImage();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!message.trim() || !workspaceId) return;

    try {
      await createMessage.mutateAsync({
        workspaceId,
        userId: currentUserId,
        content: message.trim(),
        type: 'text',
      });
      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file || !workspaceId) return;

    if (!file.type.startsWith('image/')) {
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setPreviewImage(dataUrl);
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  }, [workspaceId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    },
    noClick: true,
    noKeyboard: true,
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspaceId) return;

    if (!file.type.startsWith('image/')) {
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setPreviewImage(dataUrl);
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSendImage = async () => {
    if (!previewImage || !workspaceId) return;

    try {
      await createImage.mutateAsync({
        workspaceId,
        imageUrl: previewImage,
        createdBy: currentUserId,
      });
      setPreviewImage(null);
    } catch (error) {
      console.error('Failed to upload image:', error);
    }
  };

  const cancelPreview = () => {
    setPreviewImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div {...getRootProps()} className={clsx(
      "h-full flex flex-col rounded-lg border-2 transition-colors",
      isDragActive ? "border-primary bg-primary/5" : "border-transparent"
    )}>
      <input {...getInputProps()} />
      
      {isDragActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-lg z-10">
          <div className="text-center">
            <Upload className="h-12 w-12 mx-auto mb-2 text-primary" />
            <p className="text-lg font-medium">Drop image here</p>
            <p className="text-sm text-muted-foreground">Release to upload</p>
          </div>
        </div>
      )}

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-3 p-2">
        {messages && messages.length > 0 ? (
          messages.map((msg: Message) => (
            <div
              key={msg._id}
              className={clsx(
                "flex",
                msg.userId === currentUserId ? "justify-end" : "justify-start"
              )}
            >
              <div className={clsx(
                "max-w-[80%] rounded-lg px-3 py-2",
                msg.userId === currentUserId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}>
                {msg.type === 'image' ? (
                  <img
                    src={msg.content}
                    alt="Shared image"
                    className="max-w-full rounded-md"
                  />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
                <p className={clsx(
                  "text-xs mt-1",
                  msg.userId === currentUserId
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground"
                )}>
                  {msg.userId === currentUserId ? 'You' : msg.userId.slice(0, 8)}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <p>No messages yet</p>
              <p className="text-sm">Start the conversation!</p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Image Preview */}
      {previewImage && (
        <div className="p-3 border-t bg-muted/50">
          <div className="relative inline-block">
            <img
              src={previewImage}
              alt="Preview"
              className="max-h-32 rounded-md"
            />
            <Button
              variant="destructive"
              size="icon"
              className="h-6 w-6 absolute -top-2 -right-2"
              onClick={cancelPreview}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={handleSendImage} disabled={createImage.isPending}>
              <Send className="h-4 w-4 mr-1" />
              Send Image
            </Button>
            <Button size="sm" variant="outline" onClick={cancelPreview}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Message Input */}
      <div className="p-3 border-t shrink-0">
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="h-4 w-4" />
            )}
          </Button>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="min-h-[44px] max-h-32 resize-none"
            rows={1}
          />
          <Button onClick={handleSendMessage} disabled={!message.trim() || createMessage.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Drag and drop images directly into the chat
        </p>
      </div>
    </div>
  );
}

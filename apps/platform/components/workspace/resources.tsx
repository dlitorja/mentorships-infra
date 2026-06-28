'use client';

import { useState, useRef } from 'react';
import { Id } from '../../../../convex/_generated/dataModel';
import { useInstructorResources, useUploadInstructorResource, useDeleteInstructorResource, useShareResourceToChat, useEmbedResourceInNote, useWorkspaceNotes, InstructorResource } from '@/lib/queries/convex/use-workspaces';
import { uploadFileForChat, MAX_CHAT_FILE_BYTES, LARGE_CHAT_FILE_BYTES } from '@/lib/workspace-image-upload';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDropzone } from 'react-dropzone';
import { Loader2, Upload, FileText, ImageIcon, Share2, Trash2, X, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { useConvexAction } from '@convex-dev/react-query';

interface WorkspaceResourcesProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
  role: 'instructor' | 'student' | 'admin';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function WorkspaceResources({ workspaceId, currentUserId, role }: WorkspaceResourcesProps) {
  const { data: resources, isLoading } = useInstructorResources(workspaceId as string);
  const uploadResource = useUploadInstructorResource();
  const deleteResource = useDeleteInstructorResource();
  const shareToChat = useShareResourceToChat();
  const embedInNote = useEmbedResourceInNote();
  const generateUploadUrl = useConvexAction(api.workspaceActions.generateWorkspaceImageUploadUrl);

  const [deleteConfirmId, setDeleteConfirmId] = useState<Id<'instructorResources'> | null>(null);
  const [embedNoteId, setEmbedNoteId] = useState<Id<'instructorResources'> | null>(null);
  const [selectedNoteForEmbed, setSelectedNoteForEmbed] = useState<Id<'workspaceNotes'> | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);

  const onDrop = async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      if (file.size > MAX_CHAT_FILE_BYTES) {
        toast.error(`${file.name}: exceeds 50MB limit`);
        continue;
      }
      if (file.size > LARGE_CHAT_FILE_BYTES) {
        toast.warning(`${file.name}: large file (${formatBytes(file.size)}) will count toward your image limit`);
      }

      setUploadingCount(c => c + 1);
      try {
        const type = file.type.startsWith('image/') ? 'image' : 'file';
        const uploadResult = await uploadFileForChat(
          workspaceId,
          file,
          (args) => (generateUploadUrl as (args: { workspaceId: Id<'workspaces'> }) => Promise<string>)(args)
        );

        if (!uploadResult.success) {
          toast.error(uploadResult.error || 'Upload failed');
          continue;
        }

        await uploadResource.mutateAsync({
          workspaceId,
          storageId: uploadResult.storageId as Id<"_storage">,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          type,
        });

        toast.success(`${file.name} uploaded`);
      } catch (error: any) {
        toast.error(error.message || 'Upload failed');
      } finally {
        setUploadingCount(c => c - 1);
      }
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  });

  const handleDelete = async (id: Id<'instructorResources'>) => {
    try {
      await deleteResource.mutateAsync({ id });
      setDeleteConfirmId(null);
      toast.success('Resource deleted');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete resource');
    }
  };

  const handleShareToChat = async (id: Id<'instructorResources'>) => {
    try {
      await shareToChat.mutateAsync({ resourceId: id, workspaceId });
      toast.success('Shared to chat');
    } catch (error: any) {
      toast.error(error.message || 'Failed to share to chat');
    }
  };

  const handleEmbedInNote = async () => {
    if (!embedNoteId || !selectedNoteForEmbed) return;
    try {
      await embedInNote.mutateAsync({ resourceId: embedNoteId, noteId: selectedNoteForEmbed });
      setEmbedNoteId(null);
      setSelectedNoteForEmbed(null);
      toast.success('Embedded in note');
    } catch (error: any) {
      toast.error(error.message || 'Failed to embed in note');
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
    <div className="h-full flex flex-col gap-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
        }`}
      >
        <input {...getInputProps()} />
        {uploadingCount > 0 ? (
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm text-muted-foreground">Uploading...</span>
          </div>
        ) : (
          <>
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {isDragActive
                ? 'Drop files here'
                : 'Drag & drop files here, or click to select. Images >10MB show a warning; >50MB are rejected.'}
            </p>
          </>
        )}
      </div>

      {Array.isArray(resources) && resources.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 overflow-y-auto">
          {resources.map((resource: InstructorResource) => (
            <div
              key={resource._id}
              className="group relative border rounded-lg overflow-hidden bg-card hover:border-primary/50 transition-colors"
            >
              {resource.type === 'image' && resource.url ? (
                <div className="aspect-square bg-muted flex items-center justify-center">
                  <img
                    src={resource.url}
                    alt={resource.fileName}
                    className="object-cover w-full h-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              ) : (
                <div className="aspect-square bg-muted flex flex-col items-center justify-center p-2">
                  <FileText className="h-10 w-10 text-muted-foreground" />
                  <p className="text-xs text-center text-muted-foreground mt-1 truncate w-full px-1">
                    {resource.fileName}
                  </p>
                </div>
              )}

              <div className="p-1.5">
                <p className="text-xs truncate" title={resource.fileName}>
                  {resource.fileName}
                </p>
                <p className="text-xs text-muted-foreground">{formatBytes(resource.size)}</p>
              </div>

              <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {resource.type === 'image' && (
                  <>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-6 w-6"
                      title="Share to chat"
                      onClick={() => handleShareToChat(resource._id)}
                      disabled={shareToChat.isPending}
                    >
                      <Share2 className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-6 w-6"
                      title="Embed in note"
                      onClick={() => setEmbedNoteId(resource._id)}
                      disabled={embedInNote.isPending}
                    >
                      <ImageIcon className="h-3 w-3" />
                    </Button>
                  </>
                )}
                <Button
                  size="icon"
                  variant="destructive"
                  className="h-6 w-6"
                  title="Delete"
                  onClick={() => setDeleteConfirmId(resource._id)}
                  disabled={deleteResource.isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No resources yet</p>
            <p className="text-xs mt-1">Upload files to build your instructor library</p>
          </div>
        </div>
      )}

      {deleteConfirmId && (
        <Dialog open onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete resource?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will permanently delete the resource. Any images already shared to chat or embedded in notes will remain there.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDelete(deleteConfirmId)}
                disabled={deleteResource.isPending}
              >
                {deleteResource.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <EmbedNoteDialog
        open={!!embedNoteId}
        onOpenChange={(open) => {
          if (!open) {
            setEmbedNoteId(null);
            setSelectedNoteForEmbed(null);
          }
        }}
        workspaceId={workspaceId}
        onEmbed={handleEmbedInNote}
        isPending={embedInNote.isPending}
        selectedNoteId={selectedNoteForEmbed}
        onNoteChange={setSelectedNoteForEmbed}
      />
    </div>
  );
}

interface EmbedNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: Id<'workspaces'>;
  onEmbed: () => void;
  isPending: boolean;
  selectedNoteId: Id<'workspaceNotes'> | null;
  onNoteChange: (id: Id<'workspaceNotes'> | null) => void;
}

function EmbedNoteDialog({ open, onOpenChange, workspaceId, onEmbed, isPending, selectedNoteId, onNoteChange }: EmbedNoteDialogProps) {
  const { data: notes } = useWorkspaceNotes(workspaceId as string);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Embed in note</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select a note to embed this image in. The image will be inserted into the note and appear in the Images tab.
          </p>
          <Select
            value={selectedNoteId ?? ''}
            onValueChange={(v) => onNoteChange(v as Id<'workspaceNotes'>)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a note" />
            </SelectTrigger>
            <SelectContent>
              {!notes || notes.length === 0 ? (
                <div className="p-2 text-sm text-muted-foreground">No notes available. Create a note first.</div>
              ) : (
                notes.map((note: any) => (
                  <SelectItem key={note._id} value={note._id}>
                    {note.title}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onEmbed} disabled={!selectedNoteId || isPending}>
            {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Embed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
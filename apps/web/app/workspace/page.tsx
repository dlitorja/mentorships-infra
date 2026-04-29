'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Id } from '../../../../convex/_generated/dataModel';
import { useCurrentUser } from '@/lib/queries/convex';
import { useUserWorkspaces } from '@/lib/queries/convex/use-workspaces';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import WorkspaceChat from '@/components/workspace/chat';
import WorkspaceNotes from '@/components/workspace/notes';
import WorkspaceImages from '@/components/workspace/images';
import { RetentionWarningBanner } from '@/components/workspace/retention-warning-banner';

interface WorkspaceWithMentor {
  _id: Id<'workspaces'>;
  name: string;
  description?: string;
  ownerId: string;
  mentorId?: Id<'instructors'>;
  mentorEmail?: string;
  menteeImageCount: number;
  mentorImageCount: number;
  endedAt?: number;
}

export default function WorkspacePage() {
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser();
  const { data: dbUser, isLoading: dbLoading } = useCurrentUser();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<Id<'workspaces'> | null>(null);
  const [activeTab, setActiveTab] = useState('chat');
  const router = useRouter();

  const { data: workspaces, isLoading: workspacesLoading } = useUserWorkspaces(
    dbUser?._id || ''
  );

  useEffect(() => {
    if (workspaces && workspaces.length > 0 && !selectedWorkspaceId) {
      setSelectedWorkspaceId(workspaces[0]._id);
    }
  }, [workspaces, selectedWorkspaceId]);

  useEffect(() => {
    if (clerkLoaded && !dbLoading && (!clerkUser || !dbUser)) {
      router.push('/sign-in');
    }
  }, [clerkLoaded, dbLoading, clerkUser, dbUser, router]);

  if (!clerkLoaded || dbLoading || workspacesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!clerkUser || !dbUser) {
    return null;
  }

  const selectedWorkspace = workspaces?.find(w => w._id === selectedWorkspaceId);

  return (
    <div className="container mx-auto p-4 md:p-6 h-[calc(100vh-64px)]">
      <div className="flex flex-col md:flex-row gap-6 h-full">
        {/* Sidebar */}
        <div className="w-full md:w-64 shrink-0">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Workspaces</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {workspaces && workspaces.length > 0 ? (
                <div className="space-y-1">
                  {workspaces.map((workspace) => (
                    <button
                      key={workspace._id}
                      onClick={() => setSelectedWorkspaceId(workspace._id)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                        selectedWorkspaceId === workspace._id
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <div className="font-medium truncate">{workspace.name}</div>
                      {workspace.mentorId && (
                        <div className="text-xs opacity-70 truncate">
                          Mentor workspace
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No workspaces yet</p>
                  <p className="text-xs mt-1">
                    Workspaces are created when you reserve a seat with an instructor
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {selectedWorkspace ? (
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-3 shrink-0">
                <CardTitle className="text-xl">{selectedWorkspace.name}</CardTitle>
                {selectedWorkspace.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedWorkspace.description}
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex-1 min-h-0 pt-0">
                {selectedWorkspace.endedAt && (
                  <RetentionWarningBanner
                    workspaceId={String(selectedWorkspace._id)}
                    endedAt={selectedWorkspace.endedAt}
                  />
                )}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                  <TabsList className="shrink-0">
                    <TabsTrigger value="chat" className="gap-2">
                      <MessageSquare className="h-4 w-4" />
                      Chat
                    </TabsTrigger>
                    <TabsTrigger value="notes" className="gap-2">
                      <FileText className="h-4 w-4" />
                      Notes
                    </TabsTrigger>
                    <TabsTrigger value="images" className="gap-2">
                      <ImageIcon className="h-4 w-4" />
                      Images
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="chat" className="flex-1 min-h-0 mt-4">
                    <WorkspaceChat 
                      workspaceId={selectedWorkspace._id} 
                      currentUserId={clerkUser.id}
                    />
                  </TabsContent>
                  <TabsContent value="notes" className="flex-1 min-h-0 mt-4">
                    <WorkspaceNotes 
                      workspaceId={selectedWorkspace._id} 
                      currentUserId={clerkUser.id}
                    />
                  </TabsContent>
                  <TabsContent value="images" className="flex-1 min-h-0 mt-4">
                    <WorkspaceImages 
                      workspaceId={selectedWorkspace._id}
                      currentUserId={clerkUser.id}
                      role="mentee"
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a workspace to get started</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

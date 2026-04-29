"use client"

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

function formatInstructorName(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function FreeMentorshipContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const instructorSlug = searchParams.get('instructor') || '';

  return (
    <div className='min-h-screen bg-background flex items-center justify-center px-4 py-12'>
      <Card className='max-w-lg w-full'>
        <CardHeader className='text-center'>
          <CardTitle className='text-3xl'>Free Mentorship</CardTitle>
          <CardDescription>
            Sign up to potentially be selected for a free one-on-one mentorship session{instructorSlug ? (
              <> with <span className='font-semibold'>{formatInstructorName(instructorSlug)}</span></>
            ) : null}. Sessions may be recorded and published for educational content.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <p className='text-sm text-muted-foreground'>
            We’re currently routing free-mentorship interest through the waitlist to ensure notifications when spots open. Join the waitlist below and we’ll email you if selected.
          </p>
          <div className='flex flex-col gap-2'>
            <Button asChild size='lg' className='vibrant-gradient-button transition-all w-full'>
              <Link href={instructorSlug ? `/waitlist?instructor=${instructorSlug}&type=one-on-one` : '/waitlist'}>Join Waitlist</Link>
            </Button>
            <Button asChild variant='outline' className='w-full'>
              <Link href={instructorSlug ? `/instructors/${instructorSlug}` : '/instructors'}>
                {instructorSlug ? 'Back to Instructor' : 'View All Instructors'}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function FreeMentorshipPage(): React.JSX.Element {
  return (
    <Suspense fallback={<div className='min-h-screen bg-background flex items-center justify-center'>Loading...</div>}>
      <FreeMentorshipContent />
    </Suspense>
  );
}
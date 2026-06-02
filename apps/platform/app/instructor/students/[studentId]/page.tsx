"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { StudentDetail } from "@/components/instructor/student-detail";

export default function StudentDetailPage() {
  const params = useParams();
  const studentId = params.studentId as string;

  return (
    <div className="container mx-auto p-4 md:p-8">
      <div className="mb-6">
        <Link href="/instructor/students">
          <Button variant="ghost" className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Students
          </Button>
        </Link>
        <h1 className="text-3xl font-bold">Student Details</h1>
      </div>

      <StudentDetail studentId={studentId} />
    </div>
  );
}
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StudentTimezoneComparison } from "./student-timezone-comparison";

describe("StudentTimezoneComparison", () => {
  it("shows the student zone and relative offset against the saved instructor zone", () => {
    render(
      <StudentTimezoneComparison
        studentTimeZone="America/Chicago"
        instructorTimeZone="America/New_York"
        canEditInstructorTimeZone
      />
    );

    expect(screen.getByText("Student timezone")).toBeInTheDocument();
    expect(screen.getByText("America/Chicago")).toBeInTheDocument();
    expect(screen.getByText("America/New_York")).toBeInTheDocument();
    expect(screen.getByText(/behind you/)).toBeInTheDocument();
    // Already saved, so no settings prompt.
    expect(screen.queryByText("Set your timezone")).not.toBeInTheDocument();
  });

  it("prompts an instructor without a saved zone to set one", () => {
    render(
      <StudentTimezoneComparison
        studentTimeZone="America/Chicago"
        instructorTimeZone={null}
        canEditInstructorTimeZone
      />
    );

    expect(screen.getByText("Set your timezone")).toBeInTheDocument();
  });
});

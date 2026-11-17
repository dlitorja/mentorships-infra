import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "tests/unit/test-utils";
import { TestimonialsSection } from "./TestimonialsSection";

/**
 * Deleting a testimonial takes effect immediately (it is not part of the form's
 * Save), yet it used to happen on one click with no undo — while the rest of the
 * page asks you to press Save. Confirm first.
 */
const testimonial = {
  id: "t_1",
  name: "Sam Student",
  text: "Great mentorship",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderSection(onDelete = vi.fn()) {
  renderWithProviders(
    <TestimonialsSection
      testimonials={[testimonial]}
      setActiveTab={vi.fn()}
      onAddClick={vi.fn()}
      onDelete={onDelete}
      deleteIsPending={false}
    />
  );
  return onDelete;
}

describe("TestimonialsSection", () => {
  it("asks before deleting a testimonial", async () => {
    const onDelete = renderSection();

    fireEvent.click(
      screen.getByRole("button", { name: /delete testimonial from sam student/i })
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/Delete this testimonial/i);
    expect(dialog).toHaveTextContent(/Sam Student/);
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /delete testimonial/i }));
    expect(onDelete).toHaveBeenCalledWith("t_1");
  });
});

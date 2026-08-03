import { describe, it } from "vitest";
import { render } from "@testing-library/react";
import { Testimonials } from "@/components/landing/testimonials";
import {
  expectNoCriticalOrSeriousViolations,
  scanAccessibility,
} from "tests/unit/accessibility/axe-helper";

describe("accessibility: landing components", () => {
  it("Testimonials has no critical or serious axe violations", async () => {
    render(<Testimonials />);
    const results = await scanAccessibility(document.body);
    expectNoCriticalOrSeriousViolations(results);
  });
});

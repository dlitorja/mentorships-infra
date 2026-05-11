"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class HeaderErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error to monitoring service in production
    if (process.env.NODE_ENV === "development") {
      console.error("Header component error:", error, errorInfo);
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Fallback UI - minimal header without Clerk components
      return (
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur-md">
          <div className="container mx-auto flex h-16 items-center justify-between px-4">
            <a href="/" className="flex items-center space-x-2">
              <span className="text-xl font-bold text-foreground drop-shadow-sm">
                <span className="hidden sm:inline">Huckleberry Art Mentorships</span>
                <span className="sm:hidden">HAM</span>
              </span>
            </a>
          </div>
        </header>
      );
    }

    return this.props.children;
  }
}


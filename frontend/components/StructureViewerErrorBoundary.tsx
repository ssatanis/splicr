"use client";

import React from 'react';
import { XCircle } from 'lucide-react';
import Button from './Button';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary for Structure Viewer.
 * Catches and displays errors with Try Again and Reload Page options.
 */
export class StructureViewerErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Structure Viewer Error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full min-h-[500px] bg-surface rounded-2xl border border-border">
          <div className="flex items-center justify-center w-full bg-background/50">
            <div className="max-w-md p-6 bg-white rounded-lg shadow-lg border border-border">
              <div className="flex items-center mb-4">
                <XCircle className="w-8 h-8 text-error mr-3 flex-shrink-0" />
                <h2 className="text-xl font-semibold text-text-primary font-serif">
                  Structure Viewer Error
                </h2>
              </div>
              <p className="text-sm text-text-secondary mb-4">
                {this.state.error?.message || 'An unexpected error occurred in the structure viewer.'}
              </p>
              <p className="text-xs text-text-tertiary mb-4">
                Try again or reload the page. If the problem persists, use a modern browser (Chrome or Firefox) with WebGL enabled.
              </p>
              <div className="flex gap-3">
                <Button onClick={this.handleReset} variant="primary">
                  Try Again
                </Button>
                <button
                  type="button"
                  onClick={() => typeof window !== 'undefined' && window.location.reload()}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 font-medium text-sm transition-colors"
                >
                  Reload Page
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

"use client";

import { motion } from 'framer-motion';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import Button from './Button';

interface LoadingStateProps {
  progress?: number;
  message?: string;
}

/**
 * Loading spinner with progress indication - Modern glassmorphism design
 */
export function LoadingState({ progress = 0, message = 'Loading structure...' }: LoadingStateProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-background/90 via-background/85 to-background/90 backdrop-blur-md z-20">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="text-center bg-surface/80 backdrop-blur-sm rounded-3xl p-10 shadow-2xl border border-accent/20"
        style={{
          boxShadow: '0 20px 60px rgba(106, 191, 54, 0.15), 0 0 0 1px rgba(106, 191, 54, 0.1)',
        }}
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          className="inline-block mb-6"
        >
          <div className="relative">
            <Loader2 className="w-14 h-14 text-accent" />
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-accent/30"
              animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </div>
        </motion.div>
        <p className="text-text-primary font-semibold text-lg mb-2">{message}</p>
        {progress > 0 && progress < 100 && (
          <div className="mt-4 w-64 mx-auto">
            <div className="flex items-center justify-between text-xs text-text-tertiary mb-2">
              <span>Loading...</span>
              <span className="font-mono font-semibold text-accent">{progress}%</span>
            </div>
            <div className="h-2 bg-border rounded-full overflow-hidden shadow-inner">
              <motion.div
                className="h-full bg-gradient-to-r from-accent to-accent/70 rounded-full relative overflow-hidden"
                initial={{ width: '0%' }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              >
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                />
              </motion.div>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

interface ErrorStateProps {
  error: string;
  onRetry?: () => void;
}

/**
 * Error state with retry button - Modern design with pulse animation
 */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-background/95 via-background/90 to-background/95 backdrop-blur-sm z-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center p-10 max-w-md bg-surface/90 backdrop-blur-sm rounded-3xl shadow-2xl border border-error/20"
        style={{
          boxShadow: '0 20px 60px rgba(239, 68, 68, 0.15), 0 0 0 1px rgba(239, 68, 68, 0.1)',
        }}
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
          className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-error/10 to-error/20 mb-6 relative"
        >
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-error/30"
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <AlertCircle className="w-10 h-10 text-error" strokeWidth={2} />
        </motion.div>
        <h3 className="text-xl font-serif font-semibold text-text-primary mb-3">
          Failed to Load Structure
        </h3>
        <p className="text-text-secondary mb-8 text-sm leading-relaxed bg-background/50 rounded-lg p-4 border border-border">
          {error}
        </p>
        {onRetry && (
          <Button onClick={onRetry} variant="primary" size="md" className="group">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="inline-block"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
            </motion.div>
            Try Again
          </Button>
        )}
      </motion.div>
    </div>
  );
}

interface EmptyStateProps {
  onLoadExample?: () => void;
}

/**
 * Empty state when no structure is loaded - Modern with gradient and animation
 */
export function EmptyState({ onLoadExample }: EmptyStateProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-background/60 via-background/50 to-background/60 backdrop-blur-sm z-10">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center p-12 max-w-lg bg-surface/70 backdrop-blur-md rounded-3xl shadow-2xl border border-accent/20"
        style={{
          boxShadow: '0 20px 60px rgba(106, 191, 54, 0.1), 0 0 0 1px rgba(106, 191, 54, 0.1)',
        }}
      >
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 150 }}
          className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-gradient-to-br from-accent/10 via-accent/5 to-transparent mb-6 relative"
        >
          <motion.div
            animate={{ 
              scale: [1, 1.1, 1],
              rotate: [0, 180, 360]
            }}
            transition={{ 
              duration: 4, 
              repeat: Infinity,
              ease: 'easeInOut'
            }}
          >
            <svg
              className="w-12 h-12 text-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
          </motion.div>
          <motion.div
            className="absolute inset-0 rounded-2xl border-2 border-accent/20"
            animate={{ 
              scale: [1, 1.15, 1],
              opacity: [0.3, 0, 0.3]
            }}
            transition={{ duration: 3, repeat: Infinity }}
          />
        </motion.div>
        <h3 className="text-2xl font-serif font-semibold text-text-primary mb-3">
          Ready to Explore
        </h3>
        <p className="text-text-secondary mb-8 text-sm leading-relaxed max-w-sm mx-auto">
          Load a protein structure by entering a PDB ID, UniProt ID, or uploading your own file.
          <br />
          <span className="text-accent font-medium mt-2 inline-block">Click below to see an example!</span>
        </p>
        {onLoadExample && (
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Button onClick={onLoadExample} variant="primary" size="lg" className="shadow-lg">
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Load Example (Cas9 - 5F9R)
            </Button>
          </motion.div>
        )}
        <p className="text-xs text-text-tertiary mt-6">
          CRISPR-Cas9 structure with guide RNA and target DNA
        </p>
      </motion.div>
    </div>
  );
}

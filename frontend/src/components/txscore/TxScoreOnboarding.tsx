'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, Info } from 'lucide-react';

interface OnboardingStep {
    target: string; // Selector to highlight
    title: string;
    description: string;
    position: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

const steps: OnboardingStep[] = [
    {
        target: 'body',
        title: 'Welcome to TxScore',
        description: 'The SplicR Therapeutic Viability Score (TVS) helps you identify and prioritize therapeutic targets using our multi-dimensional scoring system. Let\'s take a quick tour.',
        position: 'center'
    },
    {
        target: '#filters-panel',
        title: 'Refine Your Search',
        description: 'Use these filters to narrow down targets based on therapeutic viability score (TVS), cancer type, protein class, and more.',
        position: 'right'
    },
    {
        target: '#key-metrics',
        title: 'At-a-Glance Metrics',
        description: 'Quickly see the top candidate, average efficacy across your selection, and a preview of the therapeutic window.',
        position: 'bottom'
    },
    {
        target: '#view-toggles',
        title: 'Switch Views',
        description: 'Toggle between the detailed list view and the analytics dashboard to visualize target distributions and relationships.',
        position: 'bottom'
    },
    {
        target: '#saved-targets-filter',
        title: 'Saved Targets',
        description: 'Filter to see only your saved candidates for focused analysis.',
        position: 'right'
    },
    {
        target: '#methodology-btn',
        title: 'Understand the Science',
        description: 'Click here anytime to review the mathematical models and data sources behind the Therapeutic Viability Score.',
        position: 'left'
    }
];

export default function TxScoreOnboarding() {
    const [isVisible, setIsVisible] = useState(false);
    const [currentStep, setCurrentStep] = useState(0);

    useEffect(() => {
        const hasSeenTour = localStorage.getItem('txscore_tour_completed');
        if (!hasSeenTour) {
            const timer = setTimeout(() => setIsVisible(true), 1500);
            return () => clearTimeout(timer);
        }
    }, []);

    useEffect(() => {
        const handleForceTour = () => {
            setCurrentStep(0);
            setIsVisible(true);
        };
        window.addEventListener('start-txscore-tour', handleForceTour);
        return () => window.removeEventListener('start-txscore-tour', handleForceTour);
    }, []);

    const handleNext = () => {
        if (currentStep < steps.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            completeTour();
        }
    };

    const handlePrev = () => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1);
        }
    };

    const completeTour = () => {
        setIsVisible(false);
        localStorage.setItem('txscore_tour_completed', 'true');
    };

    const skipTour = () => {
        completeTour();
    };

    if (!isVisible) return null;

    const step = steps[currentStep];

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] overflow-hidden">
                {/* Backdrop with Backdrop Blur */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
                />

                {/* Tooltip Card */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <motion.div
                        key={currentStep}
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ duration: 0.2 }}
                        className="pointer-events-auto bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl text-slate-900 dark:text-slate-100 border border-white/20 p-8 rounded-2xl shadow-2xl w-[28rem] max-w-[90vw] flex flex-col gap-6 relative z-[101]"
                    >
                        <button
                            onClick={skipTour}
                            className="absolute top-5 right-5 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1"
                            aria-label="Skip tour"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400 font-bold text-lg">
                                <div className="bg-blue-50/50 dark:bg-blue-900/30 p-2 rounded-lg backdrop-blur-sm">
                                    <Info className="w-6 h-6" />
                                </div>
                                <span>{step.title}</span>
                            </div>
                            <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                                {step.description}
                            </p>
                        </div>

                        <div className="flex items-center justify-between pt-4 border-t border-white/10">
                            <div className="flex gap-2">
                                {steps.map((_, i) => (
                                    <div
                                        key={i}
                                        className={`h-2 w-2 rounded-full transition-all duration-300 ${i === currentStep ? 'bg-blue-600 dark:bg-blue-400 w-4' : 'bg-slate-200 dark:bg-slate-700'
                                            }`}
                                    />
                                ))}
                            </div>

                            <div className="flex items-center gap-3">
                                {currentStep > 0 && (
                                    <button
                                        onClick={handlePrev}
                                        className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-4 py-2 font-medium transition-colors"
                                    >
                                        Back
                                    </button>
                                )}
                                <button
                                    onClick={handleNext}
                                    className="bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-400 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-md hover:shadow-lg active:scale-95 flex items-center gap-2"
                                >
                                    {currentStep === steps.length - 1 ? 'Finish' : 'Next'}
                                    {currentStep < steps.length - 1 && <ChevronRight className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>
        </AnimatePresence>
    );
}


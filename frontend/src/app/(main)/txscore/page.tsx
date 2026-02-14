
import { Suspense } from 'react';
import TxScoreDashboard from '@/components/txscore/TxScoreDashboard';

export default function TxScorePage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full text-text-secondary font-serif p-8">Loading...</div>}>
            <TxScoreDashboard />
        </Suspense>
    );
}

"use client";

import { useState } from "react";
import { Check, AlertCircle, FileText } from "lucide-react";
import UploadZone from "./UploadZone";

interface CustomLibraryInfo {
    id: string;
    name: string;
    count: number;
    guideLength: number;
    preview: Array<{ id: string; gene: string | null; sequence: string }>;
}

interface Props {
    onLibraryUploaded: (info: CustomLibraryInfo) => void;
}

export default function CustomLibraryUploader({ onLibraryUploaded }: Props) {
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<boolean>(false);
    const [libInfo, setLibInfo] = useState<CustomLibraryInfo | null>(null);

    async function handleFilesSelected(files: File[]) {
        if (files.length === 0) return;
        const file = files[0]; // Only one library file

        setUploading(true);
        setError(null);
        setSuccess(false);

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch("/api/libraries/upload", {
                method: "POST",
                body: formData,
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to upload library");
            }

            const info: CustomLibraryInfo = data.library;
            setLibInfo(info);
            setSuccess(true);
            onLibraryUploaded(info);

        } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploading(false);
        }
    }

    if (success && libInfo) {
        return (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-start gap-3">
                    <div className="pt-0.5">
                        <Check className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-sm font-medium text-green-900">Custom Library Ready</h3>
                        <p className="text-sm text-green-700 mt-1">
                            {libInfo.name} ({libInfo.count.toLocaleString()} sgRNAs, {libInfo.guideLength}bp)
                        </p>

                        {/* Minimal Preview */}
                        <div className="mt-3 bg-white rounded border border-green-100 overflow-hidden text-xs">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 text-gray-500">
                                    <tr>
                                        <th className="px-2 py-1">ID</th>
                                        <th className="px-2 py-1">Gene</th>
                                        <th className="px-2 py-1">Sequence</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {libInfo.preview.slice(0, 3).map((row, i) => (
                                        <tr key={i}>
                                            <td className="px-2 py-1 font-mono text-gray-600">{row.id}</td>
                                            <td className="px-2 py-1 text-gray-900">{row.gene || '-'}</td>
                                            <td className="px-2 py-1 font-mono text-gray-600 truncate max-w-[150px]">{row.sequence}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {libInfo.count > 3 && (
                                <div className="px-2 py-1 text-gray-400 italic bg-gray-50">
                                    ...and {libInfo.count - 3} more
                                </div>
                            )}
                        </div>

                        <button
                            onClick={() => setSuccess(false)}
                            className="mt-3 text-xs text-green-700 hover:text-green-800 underline"
                        >
                            Upload different file
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mt-4 border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Upload Custom Library (CSV/TSV)</h3>
            <p className="text-xs text-gray-500 mb-3">
                Required columns: <code>Sequence</code>. Optional: <code>ID</code>, <code>Gene</code>.
                <br />Must have headers.
            </p>

            {uploading ? (
                <div className="flex items-center justify-center p-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    <span className="ml-3 text-sm text-gray-600">Parsing library...</span>
                </div>
            ) : (
                <UploadZone onFilesSelected={handleFilesSelected} />
            )}

            {error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}
        </div>
    );
}

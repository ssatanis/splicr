
import axios from 'axios';

const API_BASE_URL = '/api';

export interface PredictionRequest {
    sequence: string;
    model?: string;
}

export interface EfficiencyResponse {
    model: string;
    efficiency_score: number;
    confidence: number;
    details: any;
}

export interface OffTargetRequest {
    sequence: string;
    max_mismatches?: number;
    model?: string;
}

export interface OffTargetSite {
    locus: string;
    sequence: string;
    mismatches: number;
    risk_score: number;
    gene?: string;
}

export interface OffTargetResponse {
    targets: OffTargetSite[];
    aggregate_risk: number;
}

export interface WindowRequest {
    on_target_score: number;
    off_target_risk: number;
}

export interface WindowResponse {
    window_score: number;
    classification: string;
    details: any;
}

export const teaApi = {
    predictEfficiency: async (req: PredictionRequest): Promise<EfficiencyResponse> => {
        const response = await axios.post(`${API_BASE_URL}/tea/predict/efficiency`, req);
        return response.data;
    },

    predictOffTargets: async (req: OffTargetRequest): Promise<OffTargetResponse> => {
        const response = await axios.post(`${API_BASE_URL}/tea/predict/off-targets`, req);
        return response.data;
    },

    calculateWindow: async (req: WindowRequest): Promise<WindowResponse> => {
        const response = await axios.post(`${API_BASE_URL}/tea/calculate-window`, req);
        return response.data;
    }
};

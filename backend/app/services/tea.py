
import random
from typing import Dict, List, Any

class TEAService:
    """
    Service for Therapeutic Editability Atlas (TEA) models.
    Handles predictions for editing efficiency, off-target risk, and therapeutic window.
    """

    def predict_efficiency(self, sequence: str, model: str = "pridict") -> Dict[str, Any]:
        """
        Predict editing efficiency for a given sequence.
        
        Args:
            sequence: The target DNA sequence (including PAM).
            model: The model to use (default: 'pridict').
            
        Returns:
            Dictionary containing efficiency score and metadata.
        """
        # STUB: Real implementation would load PRIDICT/BEHive model and run inference
        # Simulating a score between 0 and 100 based on sequence hash
        random.seed(sequence)
        score = random.uniform(20, 95)
        
        return {
            "model": model,
            "efficiency_score": round(score, 2),
            "confidence": 0.9 if model == "pridict" else 0.8,
            "details": {
                "guide_efficiency": round(score * 0.9, 2),
                "context_score": round(random.uniform(0.5, 1.0), 2)
            }
        }

    def predict_off_targets(self, sequence: str, model: str = "cas9") -> List[Dict[str, Any]]:
        """
        Predict potential off-target sites.
        
        Args:
            sequence: The target DNA sequence.
            model: The off-target prediction model (default: 'cas9').
            
        Returns:
            List of potential off-target sites with risk scores.
        """
        # STUB: Simulate finding 0-3 off-targets
        random.seed(sequence + "off")
        num_off_targets = random.randint(0, 3)
        off_targets = []
        
        chromosomes = [f"chr{i}" for i in range(1, 23)] + ["chrX", "chrY"]
        
        for i in range(num_off_targets):
            mismatches = random.randint(1, 4)
            risk = max(0, 100 - (mismatches * 20) + random.uniform(-5, 5))
            
            off_targets.append({
                "locus": f"{random.choice(chromosomes)}:{random.randint(10000, 100000000)}",
                "sequence": self._mutate_sequence(sequence, mismatches),
                "mismatches": mismatches,
                "risk_score": round(risk, 2),
                "gene": f"Gene_{random.randint(1, 1000)}" if random.random() > 0.5 else None
            })
            
        return sorted(off_targets, key=lambda x: x["risk_score"], reverse=True)

    def calculate_therapeutic_window(self, on_target_score: float, off_target_risk: float) -> Dict[str, Any]:
        """
        Calculate the therapeutic window based on on-target efficiency and off-target risk.
        
        Args:
            on_target_score: Efficiency score (0-100).
            off_target_risk: Aggregate off-target risk score (0-100).
            
        Returns:
            Dictionary with therapeutic window classification and score.
        """
        # prevent division by zero
        risk_factor = max(off_target_risk, 1.0)
        window_score = (on_target_score / risk_factor) * 10 
        
        # Classification
        if window_score > 50:
            classification = "Excellent"
        elif window_score > 20:
            classification = "Good"
        elif window_score > 5:
            classification = "Fair"
        else:
            classification = "Poor"
            
        return {
            "window_score": round(window_score, 2),
            "classification": classification,
            "on_target_contribution": on_target_score,
            "off_target_penalty": off_target_risk
        }

    def _mutate_sequence(self, sequence: str, num_mutations: int) -> str:
        """Helper to create a mutated version of a sequence for stub data."""
        bases = ['A', 'C', 'G', 'T']
        seq_list = list(sequence)
        indices = random.sample(range(len(sequence)), min(num_mutations, len(sequence)))
        
        for idx in indices:
            original = seq_list[idx]
            possible = [b for b in bases if b != original]
            if possible:
                seq_list[idx] = random.choice(possible)
                
        return "".join(seq_list)

tea_service = TEAService()

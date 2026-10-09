"use client";

import { IntakeProvider } from "./wizard-context";
import { WizardContent } from "./wizard/wizard-content";

export function AnalysisWizard(props: any) {
  return (
    <IntakeProvider>
      <WizardContent {...props} />
    </IntakeProvider>
  );
}

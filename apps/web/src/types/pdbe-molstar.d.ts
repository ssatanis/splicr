import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "pdbe-molstar": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        "custom-data-url"?: string;
        "custom-data-format"?: string;
        "alphafold-view"?: string;
        "bg-color-r"?: string;
        "bg-color-g"?: string;
        "bg-color-b"?: string;
        "highlight-color-r"?: string;
        "highlight-color-g"?: string;
        "highlight-color-b"?: string;
        "hide-controls"?: string;
        "hide-selection-icon"?: string;
        "hide-animation-icon"?: string;
        "hide-controls-icon"?: string;
        "sequence-panel"?: string;
        "pdbe-link"?: string;
      };
    }
  }
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadedFile {
  name: string;
  size: number;
  r2Key: string;
  type: string;
  /** True when file was reused from cloud (dedup) and not re-uploaded */
  reused?: boolean;
}

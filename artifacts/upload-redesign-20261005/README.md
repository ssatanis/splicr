# Upload redesign verification — October 5, 2026

Desktop and mobile screenshots show the production build's new-analysis page.

- Production build and TypeScript checks passed.
- ESLint passed for the changed application components and upload modules.
- Unit suite: 660 passed, one skipped, zero failed.
- Production browser suite: all nine tests passed against real Supabase and R2.
- Browser tests cover the file picker, multiple mixed formats, drag and drop,
  optional folders, removal, mode switching, retry, multipart upload without
  localStorage, PDF extraction, image inspection and upload-to-analysis queuing.
- R2 CORS now permits https://splicr.org and https://www.splicr.org plus the
  verification origins on localhost:3212 and 127.0.0.1:3212. Existing policies
  were preserved. Actual OPTIONS requests returned 204 with the matching origin.

## File inspection limits

All file types can be attached, with up to 64 nonempty files and 50 GB per file.
Supporting text, PDF, Word, PowerPoint and OpenDocument contents are extracted
within bounded preview limits. Images expose dimensions; image contents and scans
need visual analysis or OCR. Encrypted, corrupted and unknown binary formats are
retained with explicit limitations. A successful upload does not imply every
embedded object has been interpreted.

The UI changes are in the local workspace. The R2 CORS correction was applied
to the configured bucket. No application deployment was performed.

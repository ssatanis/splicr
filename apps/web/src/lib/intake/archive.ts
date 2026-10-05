/** Expand small experiment bundles. Large sequencing files use direct multipart upload. */
export async function expandExperimentFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  let expanded = 0;
  for (const file of files) {
    out.push(file);
    if (!/\.zip$/i.test(file.name)) continue;
    if (file.size > 64 * 1024 * 1024) throw new Error("ZIP review supports bundles up to 64 MB. Upload larger folders directly.");
    const { Unzip, UnzipInflate } = await import("fflate");
    const members: File[] = [];
    const unzip = new Unzip((entry) => {
      if (entry.name.endsWith("/") || entry.name.startsWith("__MACOSX/") || /(^|\/)\./.test(entry.name)) return;
      if (entry.name.startsWith("/") || entry.name.split("/").includes("..")) throw new Error("The archive contains an invalid path.");
      if (members.length >= 64) throw new Error("An experiment bundle can contain up to 64 files.");
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      entry.ondata = (error, data, final) => {
        if (error) throw new Error(`Could not unpack ${entry.name}.`);
        expanded += data.length;
        if (expanded > 128 * 1024 * 1024) { entry.terminate(); throw new Error("The expanded bundle exceeds 128 MB. Upload the folder directly."); }
        chunks.push(new Uint8Array(data));
        if (final) members.push(new File(chunks, `${file.name.replace(/\.zip$/i, "")}/${entry.name}`));
      };
      entry.start();
    });
    unzip.register(UnzipInflate);
    unzip.push(new Uint8Array(await file.arrayBuffer()), true);
    out.push(...members);
  }
  return out;
}

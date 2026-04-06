import { BlobWriter, BlobReader, ZipWriter } from "@zip.js/zip.js";

let zipWriter: ZipWriter<Blob> | null = null;

export function createZipWriter(): void {
  zipWriter = new ZipWriter(new BlobWriter("application/zip"));
}

export async function addPartToZip(
  filename: string,
  data: Uint8Array,
): Promise<void> {
  if (!zipWriter) throw new Error("ZipWriter not initialized");
  const blob = new Blob([data as BlobPart], { type: "audio/mpeg" });
  await zipWriter.add(filename, new BlobReader(blob), { level: 0 });
}

export async function finalizeZip(): Promise<Blob> {
  if (!zipWriter) throw new Error("ZipWriter not initialized");
  const blob = await zipWriter.close();
  zipWriter = null;
  return blob;
}

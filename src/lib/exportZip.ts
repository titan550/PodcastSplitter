import { BlobWriter, BlobReader, ZipWriter } from "@zip.js/zip.js";

let zipWriter: ZipWriter<Blob> | null = null;
let blobWriter: BlobWriter | null = null;

export function createZipWriter(): void {
  blobWriter = new BlobWriter("application/zip");
  zipWriter = new ZipWriter(blobWriter);
}

export async function addPartToZip(
  filename: string,
  data: Uint8Array,
): Promise<void> {
  if (!zipWriter) throw new Error("ZipWriter not initialized");
  const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: "audio/mpeg" });
  await zipWriter.add(filename, new BlobReader(blob), { level: 0 });
}

export async function finalizeZip(): Promise<Blob> {
  if (!zipWriter) throw new Error("ZipWriter not initialized");
  const blob = await zipWriter.close();
  zipWriter = null;
  blobWriter = null;
  return blob;
}

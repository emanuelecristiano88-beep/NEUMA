import {
  createDriveSubfolder,
  getRootFolderId,
  isDriveConfigured,
  uploadBufferToDrive,
} from "./lib/googleDrive.js";

export const config = { runtime: "nodejs", maxDuration: 60 };

type UploadSingleBody = {
  imageBase64: string;
  fileName?: string;
  folderId?: string;
  scanId?: string;
  mimeType?: string;
};

function checkUploadSecret(request: Request): boolean {
  const secret = process.env.UPLOAD_API_SECRET;
  if (!secret) return true;
  return request.headers.get("x-upload-secret") === secret;
}

function sanitizeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 180);
}

function sanitizeScanId(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return `scan_${Date.now()}`;
  return s.replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 120) || `scan_${Date.now()}`;
}

function parseBase64Payload(raw: string): Buffer {
  const trimmed = raw.trim();
  const base64 = trimmed.startsWith("data:") ? (trimmed.split(",", 2)[1] || "") : trimmed;
  if (!base64) throw new Error("imageBase64 vuoto");
  return Buffer.from(base64, "base64");
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }
  if (!checkUploadSecret(request)) {
    return Response.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }
  if (!isDriveConfigured()) {
    return Response.json({ ok: false, error: "Drive non configurato" }, { status: 500 });
  }

  try {
    const body = (await request.json()) as UploadSingleBody;
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    if (!imageBase64) {
      return Response.json({ ok: false, error: "Campo imageBase64 mancante" }, { status: 400 });
    }

    const scanId = sanitizeScanId(body.scanId);
    const fileName = sanitizeName(body.fileName || `photo_${Date.now()}.webp`);
    const mimeType =
      typeof body.mimeType === "string" && body.mimeType.startsWith("image/")
        ? body.mimeType
        : "image/webp";
    const buffer = parseBase64Payload(imageBase64);
    if (buffer.length < 64) {
      return Response.json({ ok: false, error: "Payload immagine troppo piccolo" }, { status: 400 });
    }

    let folderId = typeof body.folderId === "string" ? body.folderId.trim() : "";
    let folderLink: string | null = folderId ? `https://drive.google.com/drive/folders/${folderId}` : null;

    if (!folderId) {
      const root = getRootFolderId();
      const sub = await createDriveSubfolder(root, `scan_${scanId}`);
      folderId = sub.id;
      folderLink = `https://drive.google.com/drive/folders/${folderId}`;
    }

    const up = await uploadBufferToDrive({
      fileName,
      buffer,
      mimeType,
      parentFolderId: folderId,
    });

    return Response.json({
      ok: true,
      fileId: up.id,
      fileName,
      driveFolderId: folderId,
      driveFolderLink: folderLink,
      scanId,
      driveUploaded: true,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload-single]", e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}


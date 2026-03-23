/**
 * Upload su Google Drive (Service Account).
 * Variabili ambiente:
 * - GOOGLE_SERVICE_ACCOUNT_JSON: JSON completo del service account (stringa, una riga su Vercel)
 * - GOOGLE_DRIVE_FOLDER_ID: ID cartella Drive dove salvare (condividi la cartella con l'email del service account)
 */
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const DRIVE_REQUEST_TIMEOUT_MS = 8_000;

let cachedAuth: google.auth.GoogleAuth | null = null;

function getCredentials(): Record<string, unknown> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON non configurato");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON non valido (JSON.parse): ${msg}`);
  }
}

function getGoogleAuth() {
  if (cachedAuth) return cachedAuth;
  cachedAuth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: SCOPES,
  });
  return cachedAuth;
}

async function getAccessToken(): Promise<string> {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const value = typeof token === "string" ? token : token?.token;
  if (!value) throw new Error("Google auth: access token mancante");
  return value;
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DRIVE_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
    });
    const txt = await res.text();
    if (!res.ok) {
      throw new Error(`${label} HTTP ${res.status}: ${txt.slice(0, 500)}`);
    }
    try {
      return JSON.parse(txt) as T;
    } catch {
      throw new Error(`${label} JSON non valido`);
    }
  } catch (e: unknown) {
    if (ctrl.signal.aborted) {
      throw new Error(`${label} timeout after ${DRIVE_REQUEST_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function isDriveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export async function createDriveSubfolder(parentFolderId: string, name: string): Promise<{ id: string }> {
  const token = await getAccessToken();
  const safeName = name.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 200);
  const data = await fetchJsonWithTimeout<{ id?: string }>(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: safeName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      }),
    },
    "drive.createFolder"
  );
  const id = data.id;
  if (!id) throw new Error("Drive: cartella non creata");
  return { id };
}

export async function uploadBufferToDrive(params: {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  parentFolderId: string;
}): Promise<{ id: string; webViewLink?: string | null }> {
  const token = await getAccessToken();
  const safeName = params.fileName.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 200);
  const boundary = `neuma_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const meta = Buffer.from(
    JSON.stringify({
      name: safeName,
      parents: [params.parentFolderId],
    }),
    "utf8"
  );
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    "utf8"
  );
  const mid = Buffer.from(
    `\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const body = Buffer.concat([head, meta, mid, params.buffer, tail]);

  const data = await fetchJsonWithTimeout<{ id?: string }>(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
    `drive.uploadFile(${safeName})`
  );

  return { id: data.id ?? "", webViewLink: undefined };
}

export function getRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_FOLDER_ID non configurato");
  return id;
}

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { BooksError } from "./errors";
import { asBuffer } from "./files";

const REGION = /^[a-z0-9-]{1,32}$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_KEY =
  /^companies\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(documents|reports)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const WORKBOOK_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type ObjectStoreConfig = {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type ObjectStorage = {
  put(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
};

type ObjectBody = { transformToByteArray(): Promise<Uint8Array> };
type Send = (command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand) => Promise<{ Body?: ObjectBody }>;

const NAMES = ["AWS_REGION", "S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const;

export function readObjectStoreConfig(env: NodeJS.ProcessEnv = process.env): ObjectStoreConfig | null {
  const values = {
    AWS_REGION: env.AWS_REGION?.trim() ?? "",
    S3_BUCKET: env.S3_BUCKET?.trim() ?? "",
    AWS_ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID?.trim() ?? "",
    AWS_SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY?.trim() ?? ""
  };
  const set = NAMES.filter((name) => values[name].length > 0);
  if (set.length === 0) return null;
  const missing = NAMES.filter((name) => values[name].length === 0);
  if (missing.length > 0) {
    throw new BooksError(`Object storage is incomplete. Also set ${missing.join(", ")}.`);
  }
  if (!REGION.test(values.AWS_REGION)) throw new BooksError("AWS_REGION is not a valid region name.");
  if (!BUCKET.test(values.S3_BUCKET) || values.S3_BUCKET.includes("..")) {
    throw new BooksError("S3_BUCKET is not a valid bucket name.");
  }
  if (/\s/.test(values.AWS_ACCESS_KEY_ID) || values.AWS_ACCESS_KEY_ID.length > 128) {
    throw new BooksError("AWS_ACCESS_KEY_ID is not valid.");
  }
  if (/\s/.test(values.AWS_SECRET_ACCESS_KEY) || values.AWS_SECRET_ACCESS_KEY.length > 256) {
    throw new BooksError("AWS_SECRET_ACCESS_KEY is not valid.");
  }
  return {
    region: values.AWS_REGION,
    bucket: values.S3_BUCKET,
    accessKeyId: values.AWS_ACCESS_KEY_ID,
    secretAccessKey: values.AWS_SECRET_ACCESS_KEY
  };
}

function assertUuid(value: string, label: string): string {
  if (!UUID.test(value)) throw new BooksError(`${label} is not a valid id.`);
  return value.toLowerCase();
}

export function documentStorageKey(companyId: string, documentId: string): string {
  return `companies/${assertUuid(companyId, "Company")}/documents/${assertUuid(documentId, "Document")}`;
}

export function reportStorageKey(companyId: string, reportId: string): string {
  return `companies/${assertUuid(companyId, "Company")}/reports/${assertUuid(reportId, "Report")}`;
}

export function assertStorageKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (!STORAGE_KEY.test(normalized)) throw new BooksError("The stored file key is not valid.");
  return normalized;
}

export async function placeFile(
  storage: ObjectStorage,
  input: { key: string; body: Buffer; contentType: string }
): Promise<void> {
  await storage.put({ key: input.key, body: input.body, contentType: input.contentType });
}

export function hasStoredBytes(value: Buffer | Uint8Array | null | undefined): value is Buffer | Uint8Array {
  return value != null && value.byteLength > 0;
}

export async function loadStoredBytes(
  row: { fileData: Buffer | Uint8Array | null; storageKey: string | null },
  storage: ObjectStorage | null
): Promise<Buffer> {
  if (hasStoredBytes(row.fileData)) return asBuffer(row.fileData);
  if (!row.storageKey) throw new BooksError("This file has no stored bytes.");
  if (!storage) throw new BooksError("This file is stored in S3, but object storage is not configured.");
  return storage.get(row.storageKey);
}

export async function deleteStoredKeys(storage: ObjectStorage, keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.delete(key);
      } catch (error) {
        const name = error instanceof Error ? error.name : "Error";
        console.error("EasySlip object storage cleanup failed", name);
      }
    })
  );
}

function logStorageFailure(action: string, error: unknown, secrets: string[]): void {
  const name = error instanceof Error ? error.name : "Error";
  let message = error instanceof Error ? error.message : "unknown";
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  console.error(`EasySlip object storage ${action} failed`, name, message);
}

function userMessage(action: "stored" | "read" | "removed"): string {
  if (action === "stored") return "The file could not be stored. Try again.";
  if (action === "read") return "The stored file could not be read.";
  return "The stored file could not be removed.";
}

export function createS3ObjectStorage(config: ObjectStoreConfig, send?: Send): ObjectStorage {
  const bucket = config.bucket;
  const secrets = [config.secretAccessKey, config.accessKeyId];
  const client = send
    ? null
    : new S3Client({
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey
        }
      });
  const dispatch: Send = send ?? ((command) => client!.send(command) as Promise<{ Body?: ObjectBody }>);

  return {
    async put({ key, body, contentType }) {
      const storedKey = assertStorageKey(key);
      try {
        await dispatch(
          new PutObjectCommand({
            Bucket: bucket,
            Key: storedKey,
            Body: body,
            ContentType: contentType,
            CacheControl: "private, no-store"
          })
        );
      } catch (error) {
        logStorageFailure("stored", error, secrets);
        throw new BooksError(userMessage("stored"));
      }
    },
    async get(key) {
      const storedKey = assertStorageKey(key);
      try {
        const response = await dispatch(new GetObjectCommand({ Bucket: bucket, Key: storedKey }));
        if (!response.Body) throw new BooksError(userMessage("read"));
        return Buffer.from(await response.Body.transformToByteArray());
      } catch (error) {
        if (error instanceof BooksError) throw error;
        logStorageFailure("read", error, secrets);
        throw new BooksError(userMessage("read"));
      }
    },
    async delete(key) {
      const storedKey = assertStorageKey(key);
      try {
        await dispatch(new DeleteObjectCommand({ Bucket: bucket, Key: storedKey }));
      } catch (error) {
        logStorageFailure("removed", error, secrets);
        throw new BooksError(userMessage("removed"));
      }
    }
  };
}

let cached: { signature: string; storage: ObjectStorage } | null = null;

export function resetObjectStorageCacheForTests(): void {
  cached = null;
}

export function objectStorage(env: NodeJS.ProcessEnv = process.env): ObjectStorage | null {
  const config = readObjectStoreConfig(env);
  if (!config) {
    cached = null;
    return null;
  }
  const signature = `${config.region}\0${config.bucket}\0${config.accessKeyId}\0${config.secretAccessKey}`;
  if (cached?.signature === signature) return cached.storage;
  const storage = createS3ObjectStorage(config);
  cached = { signature, storage };
  return storage;
}

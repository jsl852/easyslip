import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "../src/lib/server/db/client";
import { readDocumentFile, saveBatch } from "../src/lib/server/documents";
import { BooksError } from "../src/lib/server/errors";
import {
  WORKBOOK_CONTENT_TYPE,
  assertStorageKey,
  createS3ObjectStorage,
  documentStorageKey,
  loadStoredBytes,
  objectStorage,
  placeFile,
  readObjectStoreConfig,
  reportStorageKey,
  resetObjectStorageCacheForTests,
  type ObjectStorage
} from "../src/lib/server/object-store";
import { getReportFile } from "../src/lib/server/reports";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const secret = "test-secret-value";
const config = {
  region: "us-west-2",
  bucket: "easyslip-private",
  accessKeyId: "test-access-key",
  secretAccessKey: secret
};

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

function memoryInsert() {
  const inserted: Array<Record<string, unknown>[]> = [];
  const db = {
    insert() {
      return {
        async values(rows: Record<string, unknown>[]) {
          inserted.push(rows);
        }
      };
    }
  };
  return { inserted, db: db as unknown as QueryClient };
}

function memorySelect(row: Record<string, unknown> | null) {
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => (row ? [row] : [])
              };
            }
          };
        }
      };
    }
  };
  return db as unknown as QueryClient;
}

function upload(name: string, bytes: Buffer): File {
  return new File([new Uint8Array(bytes)], name);
}

afterEach(() => {
  resetObjectStorageCacheForTests();
  vi.restoreAllMocks();
});

describe("object storage config", () => {
  it("stays on Postgres when the S3 variables are unset", () => {
    expect(readObjectStoreConfig(env({}))).toBeNull();
    expect(
      readObjectStoreConfig(
        env({
          AWS_REGION: " ",
          S3_BUCKET: "",
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: ""
        })
      )
    ).toBeNull();
    expect(objectStorage(env({}))).toBeNull();
  });

  it("refuses a partial configuration without echoing secrets", () => {
    expect(() =>
      readObjectStoreConfig(
        env({
          AWS_REGION: "us-west-2",
          AWS_SECRET_ACCESS_KEY: secret
        })
      )
    ).toThrow(/S3_BUCKET, AWS_ACCESS_KEY_ID/);
    try {
      readObjectStoreConfig(env({ AWS_REGION: "us-west-2", AWS_SECRET_ACCESS_KEY: secret }));
    } catch (error) {
      expect(error).toBeInstanceOf(BooksError);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("reads a complete private-bucket configuration", () => {
    expect(
      readObjectStoreConfig(
        env({
          AWS_REGION: "us-west-2",
          S3_BUCKET: "easyslip-private",
          AWS_ACCESS_KEY_ID: "test-access-key",
          AWS_SECRET_ACCESS_KEY: secret
        })
      )
    ).toEqual(config);
  });

  it("rejects a bucket name that cannot be a private S3 bucket", () => {
    expect(() =>
      readObjectStoreConfig(
        env({
          AWS_REGION: "us-west-2",
          S3_BUCKET: "Public_Bucket",
          AWS_ACCESS_KEY_ID: "test-access-key",
          AWS_SECRET_ACCESS_KEY: secret
        })
      )
    ).toThrow(/S3_BUCKET/);
  });
});

describe("storage keys", () => {
  it("keeps receipt and workbook keys inside the company prefix", () => {
    const companyId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    expect(documentStorageKey(companyId, documentId)).toBe(`companies/${companyId}/documents/${documentId}`);
    expect(reportStorageKey(companyId, reportId)).toBe(`companies/${companyId}/reports/${reportId}`);
  });

  it("rejects path traversal before any S3 call", async () => {
    expect(() => documentStorageKey("../etc", crypto.randomUUID())).toThrow(/not a valid id/);
    let called = false;
    const storage = createS3ObjectStorage(config, async () => {
      called = true;
      return {};
    });
    await expect(storage.get("companies/../secrets")).rejects.toThrow(/not valid/);
    await expect(storage.put({ key: "public/receipt.png", body: png, contentType: "image/png" })).rejects.toThrow(
      /not valid/
    );
    expect(called).toBe(false);
    expect(() => assertStorageKey("companies/not-a-uuid/documents/also-bad")).toThrow(BooksError);
  });
});

describe("S3 client", () => {
  it("puts and gets objects without a public ACL", async () => {
    const companyId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const key = documentStorageKey(companyId, documentId);
    const commands: Array<PutObjectCommand | GetObjectCommand | DeleteObjectCommand> = [];
    const storage = createS3ObjectStorage(config, async (command) => {
      commands.push(command);
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToByteArray: async () => new Uint8Array(png) } };
      }
      return {};
    });

    await placeFile(storage, { key, body: png, contentType: "image/png" });
    const put = commands[0];
    expect(put).toBeInstanceOf(PutObjectCommand);
    if (!(put instanceof PutObjectCommand)) throw new Error("expected PutObject");
    expect(put.input).toMatchObject({
      Bucket: "easyslip-private",
      Key: key,
      ContentType: "image/png",
      CacheControl: "private, no-store"
    });
    expect(put.input.ACL).toBeUndefined();
    expect(JSON.stringify(put.input)).not.toMatch(/public/i);

    const reportKey = reportStorageKey(companyId, crypto.randomUUID());
    await placeFile(storage, { key: reportKey, body: Buffer.from("workbook"), contentType: WORKBOOK_CONTENT_TYPE });
    const workbookPut = commands[1];
    expect(workbookPut).toBeInstanceOf(PutObjectCommand);
    if (!(workbookPut instanceof PutObjectCommand)) throw new Error("expected PutObject");
    expect(workbookPut.input).toMatchObject({
      Key: reportKey,
      ContentType: WORKBOOK_CONTENT_TYPE,
      Bucket: "easyslip-private"
    });
    expect(workbookPut.input.ACL).toBeUndefined();

    await expect(storage.get(key)).resolves.toEqual(png);
    expect(commands[2]).toBeInstanceOf(GetObjectCommand);
    expect(commands[2].input).toMatchObject({ Bucket: "easyslip-private", Key: key });
  });

  it("hides storage credentials when a put fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = createS3ObjectStorage(config, async () => {
      throw new Error(`signature failed for ${secret}`);
    });
    const key = documentStorageKey(crypto.randomUUID(), crypto.randomUUID());
    await expect(storage.put({ key, body: png, contentType: "image/png" })).rejects.toThrow(
      /could not be stored/
    );
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("[redacted]");
    expect(logged).not.toContain(secret);
  });
});

describe("stored bytes", () => {
  it("reads an existing Postgres file without calling S3", async () => {
    const legacy = Buffer.from("%PDF-1.4");
    const storage: ObjectStorage = {
      async put() {
        throw new Error("put");
      },
      async get() {
        throw new Error("get");
      },
      async delete() {
        throw new Error("delete");
      }
    };
    await expect(loadStoredBytes({ fileData: legacy, storageKey: null }, null)).resolves.toEqual(legacy);
    await expect(
      loadStoredBytes(
        { fileData: legacy, storageKey: documentStorageKey(crypto.randomUUID(), crypto.randomUUID()) },
        storage
      )
    ).resolves.toEqual(legacy);
  });

  it("reads an S3 object only when Postgres has no bytes", async () => {
    const key = documentStorageKey(crypto.randomUUID(), crypto.randomUUID());
    const storage: ObjectStorage = {
      async put() {},
      async get(storedKey) {
        expect(storedKey).toBe(key);
        return Buffer.from("from-s3");
      },
      async delete() {}
    };
    await expect(loadStoredBytes({ fileData: null, storageKey: key }, storage)).resolves.toEqual(
      Buffer.from("from-s3")
    );
    await expect(loadStoredBytes({ fileData: null, storageKey: key }, null)).rejects.toThrow(/not configured/);
    await expect(loadStoredBytes({ fileData: null, storageKey: null }, null)).rejects.toThrow(/no stored bytes/);
  });
});

describe("saveBatch storage switch", () => {
  it("stores new uploads in S3 and keeps the database row free of bytes", async () => {
    const companyId = crypto.randomUUID();
    const puts: Array<{ key: string; body: Buffer; contentType: string }> = [];
    const storage: ObjectStorage = {
      async put(input) {
        puts.push(input);
      },
      async get() {
        return Buffer.alloc(0);
      },
      async delete() {
        throw new Error("delete");
      }
    };
    const { inserted, db } = memoryInsert();
    const saved = await saveBatch(
      db,
      {
        companyId,
        userId: crypto.randomUUID(),
        txnType: "expense",
        settlementAccountId: crypto.randomUUID(),
        files: [upload("../../cafe receipt.png", png), upload("invoice.pdf", Buffer.from("%PDF-1.7"))]
      },
      storage
    );

    expect(saved.count).toBe(2);
    expect(puts).toHaveLength(2);
    expect(inserted).toHaveLength(1);
    const rows = inserted[0];
    expect(rows).toHaveLength(2);
    expect(puts[0].key).toBe(`companies/${companyId}/documents/${rows[0].id}`);
    expect(puts[0].contentType).toBe("image/png");
    expect(puts[0].body.equals(png)).toBe(true);
    expect(puts[1].contentType).toBe("application/pdf");
    expect(String(puts[0].key)).not.toContain("cafe");
    for (const row of rows) {
      expect(row.fileData).toBeNull();
      expect(row.storageKey).toBe(`companies/${companyId}/documents/${row.id}`);
      expect(String(row.fileName)).not.toContain("..");
    }
    expect(rows[0].fileName).toBe("cafe receipt.png");
  });

  it("keeps the Postgres payload when S3 is not configured", async () => {
    const puts: string[] = [];
    const storage: ObjectStorage = {
      async put() {
        puts.push("put");
      },
      async get() {
        return Buffer.alloc(0);
      },
      async delete() {}
    };
    const { inserted, db } = memoryInsert();
    await saveBatch(
      db,
      {
        companyId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
        txnType: "sales",
        settlementAccountId: crypto.randomUUID(),
        files: [upload("sale.png", png)]
      },
      null
    );
    expect(puts).toEqual([]);
    const row = inserted[0][0];
    expect(Buffer.isBuffer(row.fileData)).toBe(true);
    expect((row.fileData as Buffer).equals(png)).toBe(true);
    expect(row.storageKey).toBeNull();
  });

  it("does not insert a row when object storage rejects the upload, and deletes keys already written", async () => {
    const deleted: string[] = [];
    let calls = 0;
    const storage: ObjectStorage = {
      async put() {
        calls += 1;
        if (calls === 2) throw new BooksError("The file could not be stored. Try again.");
      },
      async get() {
        return Buffer.alloc(0);
      },
      async delete(key) {
        deleted.push(key);
      }
    };
    const { inserted, db } = memoryInsert();
    await expect(
      saveBatch(
        db,
        {
          companyId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
          txnType: "purchase",
          settlementAccountId: crypto.randomUUID(),
          files: [upload("one.png", png), upload("two.png", png)]
        },
        storage
      )
    ).rejects.toThrow(/could not be stored/);
    expect(inserted).toHaveLength(0);
    expect(deleted).toHaveLength(2);
  });

  it("rejects a file that is not a receipt before uploading it", async () => {
    let puts = 0;
    const storage: ObjectStorage = {
      async put() {
        puts += 1;
      },
      async get() {
        return Buffer.alloc(0);
      },
      async delete() {}
    };
    const { inserted, db } = memoryInsert();
    const notes = {
      name: "notes.txt",
      size: 5,
      arrayBuffer: async () => Uint8Array.from([104, 101, 108, 108, 111]).buffer
    } as unknown as File;
    await expect(
      saveBatch(
        db,
        {
          companyId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
          txnType: "expense",
          settlementAccountId: crypto.randomUUID(),
          files: [notes]
        },
        storage
      )
    ).rejects.toThrow(/PDF/);
    expect(puts).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});

describe("authenticated reads", () => {
  it("serves a Postgres document and a Postgres workbook without S3", async () => {
    const companyId = crypto.randomUUID();
    const storage: ObjectStorage = {
      async put() {},
      async get() {
        throw new Error("S3 should not be read");
      },
      async delete() {}
    };
    const document = await readDocumentFile(
      memorySelect({
        fileName: "legacy.png",
        mimeType: "image/png",
        fileData: png,
        storageKey: null
      }),
      companyId,
      crypto.randomUUID(),
      storage
    );
    expect(document?.fileData.equals(png)).toBe(true);

    const report = await getReportFile(
      memorySelect({
        fileName: "EasySlip.xlsx",
        fileData: Buffer.from("legacy-workbook"),
        storageKey: null,
        status: "ready"
      }),
      companyId,
      crypto.randomUUID(),
      storage
    );
    expect(report?.fileData.equals(Buffer.from("legacy-workbook"))).toBe(true);
  });

  it("loads an S3 receipt and workbook through the server", async () => {
    const companyId = crypto.randomUUID();
    const documentKey = documentStorageKey(companyId, crypto.randomUUID());
    const reportKey = reportStorageKey(companyId, crypto.randomUUID());
    const storage: ObjectStorage = {
      async put() {},
      async get(key) {
        return Buffer.from(key);
      },
      async delete() {}
    };
    const document = await readDocumentFile(
      memorySelect({
        fileName: "receipt.png",
        mimeType: "image/png",
        fileData: null,
        storageKey: documentKey
      }),
      companyId,
      crypto.randomUUID(),
      storage
    );
    expect(document?.fileData.equals(Buffer.from(documentKey))).toBe(true);

    const report = await getReportFile(
      memorySelect({
        fileName: "EasySlip.xlsx",
        fileData: null,
        storageKey: reportKey,
        status: "ready"
      }),
      companyId,
      crypto.randomUUID(),
      storage
    );
    expect(report?.fileData.equals(Buffer.from(reportKey))).toBe(true);
    await expect(
      getReportFile(
        memorySelect({
          fileName: "EasySlip.xlsx",
          fileData: null,
          storageKey: reportKey,
          status: "failed"
        }),
        companyId,
        crypto.randomUUID(),
        storage
      )
    ).resolves.toBeNull();
  });
});

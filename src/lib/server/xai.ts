import { parseModelJson, sanitizeModelExtract, stubExtract } from "$lib/accounting/extract";
import type { ExtractResult, TxnType } from "$lib/accounting/types";
import { extractText, getDocumentProxy } from "unpdf";

const DEFAULT_MODEL = "grok-4-fast";
const DEFAULT_BASE = "https://api.x.ai/v1";

async function pdfText(bytes: Buffer): Promise<string> {
  const proxy = await getDocumentProxy(new Uint8Array(bytes));
  const extracted = await extractText(proxy, { mergePages: true });
  return extracted.text.replace(/\u0000/g, " ").replace(/[ \t]+\n/g, "\n").trim().slice(0, 12000);
}

function prompt(txnType: TxnType, categories: string[], text?: string): string {
  const lines = [
    `The accountant marked this upload as: ${txnType}.`,
    "Choose suggestedCategory only from this list:",
    categories.map((name) => `- ${name}`).join("\n") || "- (no categories configured)"
  ];
  if (text) {
    lines.push("", "Text extracted from the PDF:", text);
  } else {
    lines.push("", "Read the attached image.");
  }
  return lines.join("\n");
}

export async function extractDocument(input: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  txnType: TxnType;
  categories: string[];
}): Promise<ExtractResult> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) return stubExtract(input.fileName, "XAI_API_KEY is not set, so EasySlip did not call the model.");

  const model = process.env.XAI_MODEL?.trim() || DEFAULT_MODEL;
  const base = (process.env.XAI_API_BASE?.trim() || DEFAULT_BASE).replace(/\/$/, "");

  try {
    let text: string | undefined;
    if (input.mimeType === "application/pdf") {
      text = await pdfText(input.bytes);
      if (!text) {
        return stubExtract(input.fileName, "This PDF has no text layer. Enter the invoice manually, or upload a photo of it.");
      }
    }

    const userContent =
      text === undefined
        ? [
            { type: "text", text: prompt(input.txnType, input.categories) },
            {
              type: "image_url",
              image_url: { url: `data:${input.mimeType};base64,${input.bytes.toString("base64")}` }
            }
          ]
        : prompt(input.txnType, input.categories, text);

    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You extract bookkeeping fields from receipts, invoices, and bank slips for a Hong Kong SME. Reply with JSON only. Keys: txnDate (YYYY-MM-DD or null), merchant (string), description (string), amount (positive number or null — never invent an amount), currency (ISO code or null), suggestedCategory (one of the provided names or null), confidence (0 to 1), warnings (array of short strings), language (string or null). If the document is blurry or the amount is ambiguous, set amount to null and explain in warnings. Do not convert foreign currency."
          },
          { role: "user", content: userContent }
        ]
      }),
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 180).replace(/\s+/g, " ");
      return stubExtract(
        input.fileName,
        `The AI provider returned HTTP ${response.status}${detail ? `: ${detail}` : ""}. Enter this document manually.`
      );
    }

    const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return stubExtract(input.fileName, "The model returned an empty response. Enter this document manually.");
    }
    return sanitizeModelExtract(parseModelJson(content), model);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 180) : "The model request failed.";
    return stubExtract(input.fileName, `AI request failed (${message}). Enter this document manually.`);
  }
}

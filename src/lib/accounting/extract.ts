import { hongKongToday, isIsoDate } from "./dates";
import { parseFilenameHint } from "./filename-hint";
import { centsToDecimal, toCents } from "./money";
import type { ExtractResult } from "./types";

export function stubExtract(fileName: string, note?: string): ExtractResult {
  const hint = parseFilenameHint(fileName);
  const warnings = [
    "AI fallback: this file was not read by the model. Check the date, amount, and category before you approve it."
  ];
  if (note) warnings.push(note);
  if (hint.amount) {
    warnings.push("Date, merchant, and amount were taken from the file name, not from the document.");
  }
  return {
    source: "stub",
    txnDate: hint.date ?? hongKongToday(),
    merchant: hint.merchant ?? "",
    description: hint.merchant || `Manual entry needed — ${fileName}`,
    amount: hint.amount,
    currency: "HKD",
    suggestedCategory: null,
    confidence: hint.amount ? 0.15 : 0,
    warnings
  };
}

export function sanitizeModelExtract(value: unknown, model: string): ExtractResult {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const warnings = Array.isArray(row.warnings)
    ? row.warnings.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8)
    : [];

  let amount: string | null = null;
  if (typeof row.amount === "number" && Number.isFinite(row.amount)) {
    if (row.amount < 0) warnings.push("The model returned a negative amount. EasySlip stored the absolute value.");
    amount = centsToDecimal(Math.abs(toCents(row.amount)));
  } else if (typeof row.amount === "string" && row.amount.trim()) {
    try {
      const cents = toCents(row.amount);
      if (cents < 0) warnings.push("The model returned a negative amount. EasySlip stored the absolute value.");
      amount = centsToDecimal(Math.abs(cents));
    } catch {
      warnings.push("The model amount could not be read as a number.");
    }
  } else {
    warnings.push("No amount was extracted. Enter it during review.");
  }

  const rawDate = typeof row.txnDate === "string" ? row.txnDate.trim() : "";
  const txnDate = isIsoDate(rawDate) ? rawDate : hongKongToday();
  if (!isIsoDate(rawDate)) {
    warnings.push("The document date was missing or invalid, so EasySlip used today's Hong Kong date.");
  }

  const rawCurrency = typeof row.currency === "string" ? row.currency.trim().toUpperCase() : "";
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : "HKD";
  if (currency !== "HKD") {
    warnings.push(
      `Document currency is ${currency}. EasySlip v1 posts the face amount without an exchange rate. Change the amount in review if the books should be in HKD.`
    );
  }

  let confidence = typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : 0;
  if (confidence > 1 && confidence <= 100) confidence = confidence / 100;
  confidence = Math.min(1, Math.max(0, confidence));
  if (amount === null) confidence = Math.min(confidence, 0.2);

  const merchant = typeof row.merchant === "string" ? row.merchant.trim().slice(0, 200) : "";
  const description = typeof row.description === "string" ? row.description.trim().slice(0, 500) : "";

  return {
    source: "xai",
    txnDate,
    merchant,
    description: description || merchant || "Extracted document",
    amount,
    currency,
    suggestedCategory: typeof row.suggestedCategory === "string" ? row.suggestedCategory.trim().slice(0, 120) : null,
    confidence: Math.round(confidence * 1000) / 1000,
    warnings,
    model
  };
}

export function parseModelJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

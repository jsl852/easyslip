export type KeywordRuleInput = {
  pattern: string;
  categoryId: string;
  priority: number;
  active: boolean;
};

export function matchKeyword(rules: KeywordRuleInput[], text: string): string | null {
  const haystack = text.toLowerCase();
  const ordered = rules
    .filter((rule) => rule.active && rule.pattern.trim())
    .slice()
    .sort((a, b) => b.priority - a.priority || a.pattern.localeCompare(b.pattern));
  for (const rule of ordered) {
    if (haystack.includes(rule.pattern.trim().toLowerCase())) return rule.categoryId;
  }
  return null;
}

export function matchCategoryName(
  categories: Array<{ id: string; name: string }>,
  hint: string | null | undefined
): string | null {
  const needle = hint?.trim().toLowerCase();
  if (!needle) return null;
  const exact = categories.find((category) => category.name.toLowerCase() === needle);
  if (exact) return exact.id;
  const partial = categories.find((category) => {
    const name = category.name.toLowerCase();
    return name.includes(needle) || needle.includes(name);
  });
  return partial?.id ?? null;
}

export function defaultCategoryId(
  categories: Array<{ id: string; name: string; kind: string }>,
  type: "expense" | "purchase" | "sales"
): string | null {
  const preferred = type === "sales" ? "Sales" : type === "purchase" ? "Purchases" : "General expenses";
  const named = categories.find((category) => category.name === preferred);
  if (named) return named.id;
  const kind = type === "sales" ? "revenue" : type === "purchase" ? "cogs" : "expense";
  return categories.find((category) => category.kind === kind)?.id ?? null;
}

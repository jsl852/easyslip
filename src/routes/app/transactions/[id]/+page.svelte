<script lang="ts">
  import TransactionForm from "$lib/components/TransactionForm.svelte";
  import { formatDecimal } from "$lib/accounting/format";
  import { formatIsoDate, hongKongToday } from "$lib/accounting/dates";
  import { prepareUploadFile } from "$lib/upload-prepare";
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  let { data, form } = $props();
  const expense = $derived(data.detail.expense);
  const values = $derived(
    form?.values ?? {
      type: expense.type,
      txnDate: expense.txnDate,
      merchant: expense.merchant,
      description: expense.description,
      amount: expense.amount,
      settlementAccountId: expense.settlementAccountId,
      categoryId: expense.categoryId
    }
  );
  const warnings = $derived(Array.isArray(expense.warnings) ? expense.warnings : []);
  const source = $derived(expense.extractionSource === "stub" ? "AI fallback" : expense.extractionSource === "xai" ? "AI" : "Manual");
  const outsideYear = $derived(expense.txnDate.slice(0, 4) !== hongKongToday().slice(0, 4));
  const reading = $derived(data.detail.receipts.some((receipt) => receipt.status === "queued" || receipt.status === "processing"));
  let attaching = $state(false);
  let attachNotice = $state<string | null>(null);
  let attachFiles = $state<File[]>([]);
  let attachForm = $state<HTMLFormElement | null>(null);

  $effect(() => {
    if (!reading) return;
    const timer = setInterval(() => {
      invalidateAll();
    }, 2000);
    return () => clearInterval(timer);
  });

  function kindLabel(kind: string | null, role: string | null) {
    if (role === "primary" && kind === "itemized") return "Itemized bill";
    if (role === "primary") return "Primary receipt";
    if (kind === "card_slip" || role === "payment") return "Card slip";
    if (kind === "itemized") return "Itemized bill";
    return "Receipt";
  }

  async function onAttach(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const list = input.files ? Array.from(input.files) : [];
    input.value = "";
    if (!attachForm || list.length === 0) return;
    attaching = true;
    attachNotice = null;
    try {
      const prepared: File[] = [];
      for (const file of list) prepared.push(await prepareUploadFile(file));
      attachFiles = prepared;
      attachForm.requestSubmit();
    } catch {
      attaching = false;
      attachNotice = "That photo could not be prepared.";
    }
  }
</script>

<div class="review-page">
<div class="page-head">
  <div>
    <h1>{formatDecimal(expense.amount)} · {data.detail.categoryName}</h1>
    <p class="status-line">
      <span>{formatIsoDate(expense.txnDate)}</span>
      <span class="pill {expense.extractionSource}">{source}</span>
      <span class="pill {expense.reviewStatus}">{expense.reviewStatus === "needs_review" ? "Needs review" : "Approved"}</span>
      {#if expense.paymentMethod}<span>Paid by {expense.paymentMethod}</span>{/if}
      {#if expense.groupConfidence !== null}<span>Grouped at {Math.round(Number(expense.groupConfidence) * 100)}%</span>{/if}
      {#if expense.aiConfidence !== null}<span>confidence {Math.round(Number(expense.aiConfidence) * 100)}%</span>{/if}
    </p>
  </div>
  {#if data.detail.nextReviewId}<a class="button secondary" href={`/app/transactions/${data.detail.nextReviewId}`}>Next in review</a>{/if}
</div>

{#if form?.message}<p class="callout">{form.message}</p>{/if}
{#if attachNotice}<p class="callout">{attachNotice}</p>{/if}
{#if outsideYear}
  <p class="callout">This date is outside the current Hong Kong calendar year. It stays in the books and is omitted from report packs that do not cover it.</p>
{/if}
{#if expense.originalCurrency}
  <p class="callout">Document currency was {expense.originalCurrency}. The posted amount is the face amount, with no exchange conversion.</p>
{/if}
{#if reading}<p class="callout">A receipt on this expense is still being read.</p>{/if}

<div class="split review-entry">
  <div class="stack review-form">
    {#if warnings.length}
      <div class="callout">
        <strong>Extraction notes</strong>
        <ul class="clean">
          {#each warnings as warning, index (index)}<li>{warning}</li>{/each}
        </ul>
      </div>
    {/if}
    <div class="card">
      <TransactionForm {values} accounts={data.accounts} categories={data.categories} approve />
    </div>
    <div class="card">
      <h2>Journal lines</h2>
      <p class="sub">One expense posts one debit and one credit, however many receipts are attached.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Type</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>
            {#each data.detail.lines as line (line.id)}
              <tr>
                <td>{line.docTypeCode}</td>
                <td>{line.accountCode} {line.accountName}</td>
                <td class="num">{formatDecimal(line.debit)}</td>
                <td class="num">{formatDecimal(line.credit)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
    {#if data.detail.suggestions.length}
      <div class="card stack">
        <h2>Possible same purchase</h2>
        <p class="sub">These matches are below 90%, so EasySlip left them as separate expenses.</p>
        {#each data.detail.suggestions as suggestion (suggestion.relationId)}
          <div class="stack">
            <p>
              <a href={`/app/transactions/${suggestion.expense.id}`}>{suggestion.expense.description}</a>
              · {formatIsoDate(suggestion.expense.txnDate)} · {formatDecimal(suggestion.expense.amount)}
              · {Math.round(Number(suggestion.confidence) * 100)}%
            </p>
            <p class="sub">{suggestion.reason}</p>
            <div class="actions">
              <form method="POST" action="?/merge">
                <input type="hidden" name="sourceId" value={suggestion.expense.id} />
                <button type="submit">Merge onto this expense</button>
              </form>
              <form method="POST" action="?/dismiss">
                <input type="hidden" name="relationId" value={suggestion.relationId} />
                <button class="secondary" type="submit">Not the same</button>
              </form>
            </div>
          </div>
        {/each}
      </div>
    {/if}
    {#if data.mergeTargets.length}
      <form class="card stack" method="POST" action="?/merge">
        <h2>Merge another expense</h2>
        <label>
          <span>Bring its receipts here and drop its journal entry</span>
          <select name="sourceId" required>
            {#each data.mergeTargets as target (target.id)}
              <option value={target.id}>{formatIsoDate(target.txnDate)} · {target.description} · {formatDecimal(target.amount)}</option>
            {/each}
          </select>
        </label>
        <button class="secondary" type="submit">Merge</button>
      </form>
    {/if}
    {#if data.detail.history.length}
      <div class="card">
        <h2>Activity</h2>
        <ul class="clean">
          {#each data.detail.history as event (event.id)}
            <li>{formatIsoDate(event.createdAt.toISOString().slice(0, 10))} · {event.action}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
  <aside class="stack preview-pane">
    {#if data.detail.receipts.length === 0}
      <div class="card"><p>No source file. This expense was posted by hand.</p></div>
    {:else}
      <div class="receipt-stack">
        {#each data.detail.receipts as receipt (receipt.id)}
          <figure>
            <figcaption class="receipt-label">
              {kindLabel(receipt.documentKind, receipt.role)}
              {#if receipt.status === "failed" || receipt.status === "queued" || receipt.status === "processing"}
                · {receipt.status === "failed" ? "Failed" : "Reading"}
              {/if}
            </figcaption>
            <div class="preview">
              {#if receipt.mimeType === "application/pdf"}
                <iframe title={receipt.fileName} src={`/app/documents/${receipt.id}/file`}></iframe>
              {:else}
                <img alt={receipt.fileName} src={`/app/documents/${receipt.id}/file`} />
              {/if}
            </div>
            <p class="file-name">{receipt.fileName}</p>
            {#if receipt.error}<p class="sub">{receipt.error}</p>{/if}
            <div class="actions">
              <a class="button secondary" href={`/app/documents/${receipt.id}/file`}>Open</a>
              {#if data.detail.receipts.length > 1}
                <form method="POST" action="?/split">
                  <input type="hidden" name="receiptId" value={receipt.id} />
                  <button class="secondary" type="submit">Split off</button>
                </form>
              {/if}
              {#if receipt.status === "failed" || receipt.status === "needs_split" || (receipt.status === "extracted" && expense.reviewStatus === "needs_review")}
                <form method="POST" action="?/retry">
                  <input type="hidden" name="id" value={receipt.id} />
                  <button class="secondary" type="submit">Retry</button>
                </form>
              {/if}
            </div>
          </figure>
        {/each}
      </div>
    {/if}
    <form
      class="card stack"
      method="POST"
      action="?/attach"
      enctype="multipart/form-data"
      bind:this={attachForm}
      use:enhance={({ formData, cancel }) => {
        if (attachFiles.length === 0) {
          attachNotice = "Take a photo or choose a file first.";
          cancel();
          return;
        }
        formData.delete("files");
        for (const file of attachFiles) formData.append("files", file);
        attaching = true;
        return async ({ result, update }) => {
          attaching = false;
          attachFiles = [];
          if (result.type === "failure") attachNotice = String(result.data?.message ?? "The receipt could not be attached.");
          await update();
        };
      }}
    >
      <h2>Attach a receipt</h2>
      <p class="sub">The photo is compressed in the browser. It is added to this expense and does not create another journal line.</p>
      <div class="file-choices">
        <label class="file-choice">
          <input name="files" type="file" accept="image/*" capture="environment" disabled={attaching} onchange={onAttach} />
          <span class="file-choice-kicker">Camera</span>
          <span class="file-choice-title">{attaching ? "Attaching…" : "Take photo"}</span>
        </label>
        <label class="file-choice file-choice-secondary">
          <input name="files" type="file" accept="image/*,application/pdf" multiple disabled={attaching} onchange={onAttach} />
          <span class="file-choice-kicker">Library</span>
          <span class="file-choice-title">Photo library or file</span>
        </label>
      </div>
    </form>
  </aside>
</div>
</div>

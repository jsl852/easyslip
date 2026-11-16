<script lang="ts">
  import TransactionForm from "$lib/components/TransactionForm.svelte";
  import { formatDecimal } from "$lib/accounting/format";
  import { formatIsoDate } from "$lib/accounting/dates";
  import { hongKongToday } from "$lib/accounting/dates";
  let { data, form } = $props();
  const txn = $derived(data.detail.transaction);
  const values = $derived(
    form?.values ?? {
      type: txn.type,
      txnDate: txn.txnDate,
      merchant: txn.merchant,
      description: txn.description,
      amount: txn.amount,
      settlementAccountId: txn.settlementAccountId,
      categoryId: txn.categoryId
    }
  );
  const warnings = $derived(Array.isArray(txn.warnings) ? txn.warnings : []);
  const source = $derived(txn.extractionSource === "stub" ? "AI fallback" : txn.extractionSource === "xai" ? "AI" : "Manual");
  const outsideYear = $derived(txn.txnDate.slice(0, 4) !== hongKongToday().slice(0, 4));
</script>

<div class="page-head">
  <div>
    <h1>Review entry</h1>
    <p class="sub">
      <span class="pill {txn.extractionSource}">{source}</span>
      <span class="pill {txn.reviewStatus}">{txn.reviewStatus === "needs_review" ? "Needs review" : "Approved"}</span>
      {#if txn.aiConfidence !== null} · confidence {Math.round(Number(txn.aiConfidence) * 100)}%{/if}
    </p>
  </div>
  {#if data.detail.nextReviewId}<a href={`/app/transactions/${data.detail.nextReviewId}`}>Next in review</a>{/if}
</div>

{#if form?.message}<p class="callout">{form.message}</p>{/if}
{#if outsideYear}
  <p class="callout">This date is outside the current Hong Kong calendar year. It stays in the books and is omitted from report packs that do not cover it.</p>
{/if}
{#if txn.originalCurrency}
  <p class="callout">Document currency was {txn.originalCurrency}. The posted amount is the face amount, with no exchange conversion.</p>
{/if}

<div class="split">
  <div class="stack">
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
  <aside class="stack">
    {#if data.detail.document}
      <div class="preview">
        {#if data.detail.document.mimeType === "application/pdf"}
          <iframe title={data.detail.document.fileName} src={`/app/documents/${data.detail.document.id}/file`}></iframe>
        {:else}
          <img alt={data.detail.document.fileName} src={`/app/documents/${data.detail.document.id}/file`} />
        {/if}
      </div>
      <p class="sub">{data.detail.document.fileName}</p>
    {:else}
      <div class="card"><p>No source file. This entry was posted by hand.</p></div>
    {/if}
  </aside>
</div>

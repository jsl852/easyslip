<script lang="ts">
  import { formatDecimal } from "$lib/accounting/format";
  import { formatIsoDate } from "$lib/accounting/dates";
  let { data } = $props();

  function sourceLabel(source: string) {
    if (source === "stub") return "AI fallback";
    if (source === "xai") return "AI";
    return "Manual";
  }
</script>

<div class="page-head">
  <div>
    <h1>Review</h1>
    <p class="sub">Every expense starts here. Approving it keeps the single journal entry and marks the expense as reviewed.</p>
  </div>
</div>

{#if data.queued > 0}
  <p class="callout">{data.queued} receipt{data.queued === 1 ? " is" : "s are"} still being read. <a href="/app/upload">Watch the batch</a>.</p>
{/if}

{#if data.queue.length === 0}
  <div class="card"><p>The review queue is clear.</p></div>
{:else}
  <div class="mobile-cards">
    {#each data.queue as row (row.id)}
      <article class="doc-card">
        <div class="doc-card-top">
          <span class="pill {row.extractionSource}">{sourceLabel(row.extractionSource)}</span>
          <b class="money">{formatDecimal(row.amount)}</b>
        </div>
        <a class="file-name" href={`/app/transactions/${row.id}`}>{row.description}</a>
        <p class="sub">{formatIsoDate(row.txnDate)} · {row.type} · {row.categoryName}{#if row.receiptCount > 1} · {row.receiptCount} receipts{/if}</p>
        <a class="button" href={`/app/transactions/${row.id}`}>Open preview</a>
      </article>
    {/each}
  </div>
  <div class="table-wrap mobile-table">
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Category</th><th>Source</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>
        {#each data.queue as row (row.id)}
          <tr>
            <td>{formatIsoDate(row.txnDate)}</td>
            <td>{row.type}</td>
            <td>{row.description}</td>
            <td>{row.categoryName}</td>
            <td><span class="pill {row.extractionSource}">{sourceLabel(row.extractionSource)}</span></td>
            <td class="num">{formatDecimal(row.amount)}</td>
            <td><a href={`/app/transactions/${row.id}`}>Open</a></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

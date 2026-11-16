<script lang="ts">
  import { formatDecimal } from "$lib/accounting/format";
  import { formatIsoDate } from "$lib/accounting/dates";
  let { data } = $props();
</script>

<div class="page-head">
  <div>
    <h1>Review</h1>
    <p class="sub">Every extracted or manual entry starts here. Approving it keeps the journal lines and marks the row as reviewed.</p>
  </div>
</div>

{#if data.queued > 0}
  <p class="callout">{data.queued} document{data.queued === 1 ? " is" : "s are"} still being read. <a href="/app/upload">Watch the batch</a>.</p>
{/if}

{#if data.queue.length === 0}
  <div class="card"><p>The review queue is clear.</p></div>
{:else}
  <div class="table-wrap">
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Category</th><th>Source</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>
        {#each data.queue as row (row.id)}
          <tr>
            <td>{formatIsoDate(row.txnDate)}</td>
            <td>{row.type}</td>
            <td>{row.description}</td>
            <td>{row.categoryName}</td>
            <td><span class="pill {row.extractionSource}">{row.extractionSource === "stub" ? "AI fallback" : row.extractionSource === "xai" ? "AI" : "Manual"}</span></td>
            <td class="num">{formatDecimal(row.amount)}</td>
            <td><a href={`/app/transactions/${row.id}`}>Open</a></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<script lang="ts">
  import { formatDecimal } from "$lib/accounting/format";
  import { formatIsoDate } from "$lib/accounting/dates";
  let { data } = $props();
  const title = $derived(data.type === "all" ? "Ledger" : data.type[0].toUpperCase() + data.type.slice(1) + "s");
</script>

<div class="page-head">
  <div>
    <h1>{title}</h1>
    <p class="sub">One row is one booked expense. Several receipts can support the same purchase.</p>
  </div>
  <a class="button" href="/app/transactions/new">Manual entry</a>
</div>

{#if data.rows.length === 0}
  <div class="card"><p>No {data.type === "all" ? "entries" : data.type + "s"} yet.</p></div>
{:else}
  <div class="table-wrap">
    <table>
      <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th>Receipts</th><th>Status</th><th class="num">Amount</th></tr></thead>
      <tbody>
        {#each data.rows as row (row.id)}
          <tr>
            <td>{formatIsoDate(row.txnDate)}</td>
            <td><a href={`/app/transactions/${row.id}`}>{row.description}</a></td>
            <td>{row.categoryName}</td>
            <td>{row.accountCode} {row.accountName}</td>
            <td>{row.receiptCount}</td>
            <td><span class="pill {row.reviewStatus}">{row.reviewStatus === "needs_review" ? "Needs review" : "Approved"}</span></td>
            <td class="num">{formatDecimal(row.amount)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
